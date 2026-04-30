/**
 * Scheduler Contextual - Envío basado en flujo natural del negocio
 * Distribuye mensajes según la agenda real de citas, no en lote
 * Simula comportamiento humano indistinguible de uso manual
 * 
 * GARANTÍA DE IDEMPOTENCIA:
 * - UNIQUE constraint en DB (appointmentId + reminderType)
 * - Locks distribuidos con Redis (con fallback a memoria solo en dev)
 * - Tokens de ownership para prevenir liberación de locks ajenos
 */

const { ScheduledMessage, Appointment, Business, Service, AppointmentReminderEvent } = require('../../models');
const { Op, sequelize } = require('../../models');
const whatsappService = require('../evolutionService');
const { acquireLock, releaseLock, createLockHeartbeat, initRedis, isRedisAvailable, LOCK_CONFIG } = require('./distributedLock');

// === Inicializar Redis para locks distribuidos ===
let redisInitialized = false;
initRedis().then(() => {
  redisInitialized = true;
  console.log('[ContextualScheduler] ✅ Redis locks inicializados');
}).catch(err => {
  console.log('[ContextualScheduler] ⚠️ Redis locks no disponible:', err.message);
  // En producción, bloquear el scheduler si no hay Redis
  if (process.env.NODE_ENV === 'production') {
    console.error('[ContextualScheduler] 🛑 CRÍTICO: Redis requerido en producción. Scheduler no iniciará.');
    process.exit(1);
  }
});

// === Métricas de monitoreo ===
const schedulerMetrics = {
  lagMs: 0,
  backlog: 0,
  droppedMessages: 0,
  onTimeDelivery: 0,
  totalProcessed: 0,
  lastRun: null,
  // Métricas de concurrencia
  duplicateAvoided: 0,
  lockContentionCount: 0,
  lockContentionTotal: 0,
  expiredLocks: 0,
  dbUniqueViolations: 0,
  // Métricas de observabilidad (detectan problemas reales)
  sendFailures: 0,
  retryCount: 0,
  retrySuccess: 0,
  totalSendLatencyMs: 0,
  sendCount: 0,
  // Array de latencias recientes para calcular percentiles (mantener últimas 1000)
  recentLatencies: []
};

// === Configuración ===
const CONTEXTUAL_CONFIG = {
  // Ventanas de envío según tipo de mensaje (relativas a hora de cita)
  REMINDER_WINDOWS: {
    '24h': { before: 26 * 60 * 60 * 1000, after: 22 * 60 * 60 * 1000 }, // 22-26h antes
    '12h': { before: 14 * 60 * 60 * 1000, after: 10 * 60 * 60 * 1000 }, // 10-14h antes
    '2h': { before: 3 * 60 * 60 * 1000, after: 1.5 * 60 * 60 * 1000 }, // 1.5-3h antes
    '1h': { before: 1.5 * 60 * 60 * 1000, after: 0.75 * 60 * 60 * 1000 }, // 45min-1.5h antes
  },

  // TTL por tipo de recordatorio (para controlar backlog y evitar envíos fuera de contexto)
  REMINDER_TTL: {
    '24h': 4 * 60 * 60 * 1000,    // 4 horas de TTL (ej: ventana 22-26h, enviar hasta 26h+4h)
    '12h': 2 * 60 * 60 * 1000,    // 2 horas de TTL
    '2h': 45 * 60 * 1000,         // 45 minutos de TTL
    '1h': 20 * 60 * 1000,         // 20 minutos de TTL
  },

  // Grace period para tolerancia a timing drift (5-10 minutos)
  GRACE_PERIOD_MS: 5 * 60 * 1000, // 5 minutos

  // Límites por negocio para simular capacidad humana
  MAX_MESSAGES_PER_HOUR_PER_BUSINESS: 5,
  MAX_MESSAGES_PER_DAY_PER_BUSINESS: 100,

  // Fallback para recordatorios críticos: si delay > 30 min, enviar versión reducida o saltar
  CRITICAL_REMINDER_MAX_DELAY_MS: 30 * 60 * 1000, // 30 minutos
  ENABLE_REDUCED_CRITICAL_MESSAGES: true, // Enviar versión reducida si hay mucho delay

  // Política de reintentos (evita spam y bucles infinitos)
  MAX_RETRIES: 3,                    // Máximo 3 intentos por recordatorio
  RETRY_BACKOFF_MS: [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000], // 30s, 2min, 10min
  
  // Timeout de procesamiento (detectar eventos zombie)
  PROCESSING_TIMEOUT_MS: 2 * 60 * 1000, // 2 minutos máximo de procesamiento
  
  // Cleanup batch size (evitar locks largos en DB)
  CLEANUP_BATCH_SIZE: 1000,
};

// === Tracker de actividad por negocio (rate smoothing con ventana móvil) ===
const businessActivityTracker = new Map(); // businessId -> { messageTimestamps: [], lastSent: null }

// === Tracker de actividad humana por negocio ===
const humanActivityTracker = new Map(); // businessId -> { lastHumanMessageTimestamp: null }

// === Cache de patrones históricos ===
const historicalPatternCache = new Map(); // businessId -> { hourlyDistribution: {}, dailyAverage: 0 }

// === Backpressure global por servidor ===
const globalMessageTracker = []; // Array de timestamps de mensajes enviados globalmente
const GLOBAL_LIMIT_PER_MINUTE = 50; // Límite global: 50 msgs/min por servidor

/**
 * Analiza patrones históricos de citas de un negocio
 * Retorna distribución por hora y promedio diario
 */
async function analyzeBusinessHistoricalPattern(businessId) {
  // Si ya está en cache y es reciente (menos de 1 hora), usar cache
  const cached = historicalPatternCache.get(businessId);
  if (cached && cached.cachedAt && (Date.now() - cached.cachedAt) < 60 * 60 * 1000) {
    return cached.pattern;
  }

  // Analizar últimos 30 días de citas
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const appointments = await Appointment.findAll({
    where: {
      businessId,
      startTime: {
        [Op.gte]: thirtyDaysAgo
      },
      status: {
        [Op.in]: ['pending', 'confirmed', 'attention', 'done']
      }
    },
    attributes: ['startTime']
  });

  // Calcular distribución por hora (0-23)
  const hourlyDistribution = {};
  const dailyCounts = {};

  for (const appt of appointments) {
    const hour = new Date(appt.startTime).getHours();
    const dayKey = new Date(appt.startTime).toISOString().split('T')[0];

    hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
    dailyCounts[dayKey] = (dailyCounts[dayKey] || 0) + 1;
  }

  // Calcular promedio diario
  const daysWithData = Object.keys(dailyCounts).length;
  const totalAppointments = appointments.length;
  const dailyAverage = daysWithData > 0 ? totalAppointments / daysWithData : 0;

  const pattern = {
    hourlyDistribution,
    dailyAverage,
    totalAppointments,
    daysWithData
  };

  // Guardar en cache
  historicalPatternCache.set(businessId, {
    pattern,
    cachedAt: Date.now()
  });

  return pattern;
}

/**
 * Obtiene el límite de mensajes usando rate smoothing con ventana móvil de 60 minutos
 * Evita cortes artificiales por hora, simula comportamiento humano más natural
 */
async function getBusinessHourlyLimit(businessId) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  if (!businessActivityTracker.has(businessId)) {
    businessActivityTracker.set(businessId, { messageTimestamps: [], lastSent: null });
  }

  const tracker = businessActivityTracker.get(businessId);

  // Limpiar timestamps viejos (más de 24 horas)
  tracker.messageTimestamps = tracker.messageTimestamps.filter(ts => ts > oneDayAgo);

  // Contar mensajes en ventana móvil de 60 minutos
  const messagesInLastHour = tracker.messageTimestamps.filter(ts => ts > oneHourAgo).length;
  const messagesInLastDay = tracker.messageTimestamps.length;

  // Obtener patrón histórico
  const historicalPattern = await analyzeBusinessHistoricalPattern(businessId);

  // Calcular límite base ajustado por patrón histórico
  const baseHourlyLimit = CONTEXTUAL_CONFIG.MAX_MESSAGES_PER_HOUR_PER_BUSINESS;
  const baseDailyLimit = CONTEXTUAL_CONFIG.MAX_MESSAGES_PER_DAY_PER_BUSINESS;

  // Factor de ajuste basado en histórico individual del negocio (no reglas fijas)
  const historicalDailyAverage = historicalPattern.dailyAverage || 1;
  const patternMultiplier = Math.max(0.5, Math.min(2.0, historicalDailyAverage / 10)); // Ajusta según volumen real

  // Calcular límites ajustados
  const adjustedHourlyLimit = Math.floor(baseHourlyLimit * patternMultiplier);
  const adjustedDailyLimit = Math.floor(baseDailyLimit * patternMultiplier);

  return {
    canSend: messagesInLastHour < adjustedHourlyLimit && messagesInLastDay < adjustedDailyLimit,
    hourlyRemaining: adjustedHourlyLimit - messagesInLastHour,
    dailyRemaining: adjustedDailyLimit - messagesInLastDay,
    hourlyLimit: adjustedHourlyLimit,
    dailyLimit: adjustedDailyLimit,
    patternMultiplier
  };
}

/**
 * Registra un mensaje enviado para el tracker (ventana móvil)
 */
function registerMessageSent(businessId) {
  const now = Date.now();

  if (!businessActivityTracker.has(businessId)) {
    businessActivityTracker.set(businessId, { messageTimestamps: [], lastSent: null });
  }

  const tracker = businessActivityTracker.get(businessId);
  tracker.messageTimestamps.push(now);
  tracker.lastSent = now;

  businessActivityTracker.set(businessId, tracker);

  // También registrar en tracker global
  globalMessageTracker.push(now);
  // Limpiar tracker global (más de 1 minuto)
  const oneMinuteAgo = now - 60 * 1000;
  while (globalMessageTracker.length > 0 && globalMessageTracker[0] < oneMinuteAgo) {
    globalMessageTracker.shift();
  }
}

/**
 * Registra actividad humana (mensaje enviado por humano) para un negocio
 * Esta función debería llamarse cuando el negocio envía un mensaje manual
 */
function registerHumanActivity(businessId) {
  const now = Date.now();
  if (!humanActivityTracker.has(businessId)) {
    humanActivityTracker.set(businessId, { lastHumanMessageTimestamp: null });
  }
  const tracker = humanActivityTracker.get(businessId);
  tracker.lastHumanMessageTimestamp = now;
  humanActivityTracker.set(businessId, tracker);
}

/**
 * Verifica si hay actividad humana reciente (chat en curso)
 * Retorna el delay necesario para no interrumpir el flujo natural
 */
function checkHumanActivityDelay(businessId) {
  const now = Date.now();
  const minDelay = 2 * 60 * 1000; // 2 minutos mínimo
  const maxDelay = 5 * 60 * 1000; // 5 minutos máximo

  if (!humanActivityTracker.has(businessId)) {
    return 0; // No hay actividad registrada, no delay
  }

  const tracker = humanActivityTracker.get(businessId);
  const lastHumanActivity = tracker.lastHumanMessageTimestamp;

  if (!lastHumanActivity) {
    return 0; // No hay actividad registrada, no delay
  }

  const timeSinceHumanActivity = now - lastHumanActivity;

  // Si hubo actividad humana en los últimos 2-5 minutos, delay
  if (timeSinceHumanActivity < minDelay) {
    return minDelay - timeSinceHumanActivity; // Esperar hasta completar 2 min
  } else if (timeSinceHumanActivity < maxDelay) {
    // Distribución sesgada: más delay si la actividad fue muy reciente
    const normalizedTime = (timeSinceHumanActivity - minDelay) / (maxDelay - minDelay);
    const skewedDelay = (1 - Math.pow(normalizedTime, 0.5)) * (maxDelay - minDelay);
    return Math.max(0, skewedDelay);
  }

  return 0; // Actividad humana fue hace más de 5 min, no delay
}

/**
 * Verifica backpressure global por servidor
 * Retorna true si se puede enviar más mensajes globalmente
 */
function checkGlobalBackpressure() {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;

  // Contar mensajes en el último minuto globalmente
  const messagesInLastMinute = globalMessageTracker.filter(ts => ts > oneMinuteAgo).length;

  return messagesInLastMinute < GLOBAL_LIMIT_PER_MINUTE;
}

/**
 * Calcula jitter persistente por cita usando hash del ID
 * Cada cita tiene una posición fija dentro de la ventana (evita mini ráfagas)
 */
function getPersistentJitter(appointmentId, windowSizeMs) {
  // Hash simple del ID del appointment
  let hash = 0;
  const idStr = appointmentId.toString();
  for (let i = 0; i < idStr.length; i++) {
    const char = idStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convertir a 32-bit integer
  }

  // Normalizar hash a 0-1 y aplicar a ventana
  const normalizedHash = Math.abs(hash) / 2147483647; // Max 32-bit signed int
  return normalizedHash * windowSizeMs;
}

/**
 * Calcula el momento óptimo para enviar un mensaje basado en la cita
 * Usa jitter persistente para evitar mini ráfagas
 * Retorna un delay relativo al momento actual
 */
function calculateOptimalSendTime(appointment, messageType) {
  const now = Date.now();
  const appointmentTime = new Date(appointment.startTime).getTime();
  const timeUntilAppointment = appointmentTime - now;

  // Si la cita ya pasó, no enviar
  if (timeUntilAppointment < 0) {
    return null;
  }

  // Obtener ventana según tipo de mensaje
  const window = CONTEXTUAL_CONFIG.REMINDER_WINDOWS[messageType];
  if (!window) {
    // Para mensajes sin ventana específica, enviar en la próxima hora natural
    return Math.random() * 60 * 60 * 1000; // 0-1 hora
  }

  const windowWidth = window.before - window.after;

  // Calcular jitter persistente para esta cita
  const jitter = getPersistentJitter(appointment.id, windowWidth);
  const targetTimeFromAppointment = window.after + jitter;
  const targetAbsoluteTime = appointmentTime - targetTimeFromAppointment;

  // Si estamos antes del tiempo objetivo, esperar hasta ese momento
  if (now < targetAbsoluteTime) {
    return targetAbsoluteTime - now;
  }

  // Si estamos después del tiempo objetivo pero dentro de la ventana, enviar pronto
  if (timeUntilAppointment <= window.before && timeUntilAppointment >= window.after) {
    return Math.random() * 5 * 60 * 1000; // 0-5 minutos
  }

  // Si estamos después de la ventana, enviar lo antes posible
  return Math.random() * 2 * 60 * 1000; // 0-2 minutos
}

/**
 * Obtiene citas del día que necesitan recordatorios
 */
async function getTodaysAppointmentsNeedingReminders(businessId) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  
  const appointments = await Appointment.findAll({
    where: {
      businessId,
      startTime: {
        [Op.between]: [startOfDay, endOfDay]
      },
      status: {
        [Op.in]: ['pending', 'confirmed', 'attention']
      }
    },
    include: [
      { model: Service },
      { model: Business }
    ],
    order: [['startTime', 'ASC']]
  });
  
  return appointments;
}

/**
 * Determina qué recordatorios necesita una cita
 * Usa timestamps para idempotencia (garantiza envío único)
 * Incorpora grace period para timing drift y TTL para backlog control
 * Implementa load shedding: descarta menos críticos primero
 */
function determineNeededReminders(appointment, backlogStatus = 'normal') {
  const now = Date.now();
  const appointmentTime = new Date(appointment.startTime).getTime();
  const timeUntilAppointment = appointmentTime - now;
  const gracePeriod = CONTEXTUAL_CONFIG.GRACE_PERIOD_MS;

  // Si la cita está cancelada, no enviar recordatorios
  if (appointment.status === 'cancelled') {
    return [];
  }

  // Si el cliente ya confirmó, solo enviar recordatorios críticos (1h, 2h)
  const isConfirmed = appointment.status === 'confirmed' || appointment.confirmed;

  const needed = [];
  const dropped = [];

  // Recordatorio 24h (22-26h antes) - idempotente con timestamp
  // Solo si no está confirmado (evitar redundancia)
  // TTL: 4 horas después de la ventana
  const ttl24h = CONTEXTUAL_CONFIG.REMINDER_TTL['24h'];
  const windowEnd24h = 22 * 60 * 60 * 1000; // Final de ventana (22h antes)
  const canSend24h = !isConfirmed &&
                     !appointment.reminder24hSentAt &&
                     timeUntilAppointment <= (26 * 60 * 60 * 1000 + gracePeriod) && // Grace period para timing drift
                     timeUntilAppointment >= (22 * 60 * 60 * 1000 - gracePeriod) &&
                     timeUntilAppointment > (windowEnd24h - ttl24h); // No expiró TTL

  if (canSend24h) {
    if (backlogStatus === 'critical' && !isConfirmed) {
      // Load shedding: descartar 24h si hay congestión y no es crítico
      dropped.push({ type: '24h', reason: 'load_shedding' });
    } else {
      needed.push({ type: '24h', timestampField: 'reminder24hSentAt', priority: 3 });
    }
  }

  // Recordatorio 12h (10-14h antes) - idempotente con timestamp
  // Solo si no está confirmado
  // TTL: 2 horas después de la ventana
  const ttl12h = CONTEXTUAL_CONFIG.REMINDER_TTL['12h'];
  const windowEnd12h = 10 * 60 * 60 * 1000; // Final de ventana (10h antes)
  const canSend12h = !isConfirmed &&
                     !appointment.reminder12hSentAt &&
                     timeUntilAppointment <= (14 * 60 * 60 * 1000 + gracePeriod) &&
                     timeUntilAppointment >= (10 * 60 * 60 * 1000 - gracePeriod) &&
                     timeUntilAppointment > (windowEnd12h - ttl12h); // No expiró TTL

  if (canSend12h) {
    if (backlogStatus === 'critical') {
      // Load shedding: descartar 12h si hay congestión
      dropped.push({ type: '12h', reason: 'load_shedding' });
    } else {
      needed.push({ type: '12h', timestampField: 'reminder12hSentAt', priority: 3 });
    }
  }

  // Recordatorio 2h (1.5-3h antes) - idempotente con timestamp
  // Crítico: enviar siempre (confirmado o no)
  // TTL: 45 minutos después de la ventana
  const ttl2h = CONTEXTUAL_CONFIG.REMINDER_TTL['2h'];
  const windowEnd2h = 1.5 * 60 * 60 * 1000; // Final de ventana (1.5h antes)
  const canSend2h = !appointment.reminder2hSentAt &&
                    timeUntilAppointment <= (3 * 60 * 60 * 1000 + gracePeriod) &&
                    timeUntilAppointment >= (1.5 * 60 * 60 * 1000 - gracePeriod) &&
                    timeUntilAppointment > (windowEnd2h - ttl2h); // No expiró TTL

  if (canSend2h) {
    needed.push({ type: '2h', timestampField: 'reminder2hSentAt', priority: 2 });
  }

  // Recordatorio 1h (45min-1.5h antes) - idempotente con timestamp
  // Crítico: enviar siempre
  // TTL: 20 minutos después de la ventana
  const ttl1h = CONTEXTUAL_CONFIG.REMINDER_TTL['1h'];
  const windowEnd1h = 0.75 * 60 * 60 * 1000; // Final de ventana (45min antes)
  const canSend1h = !appointment.reminderSentAt &&
                    timeUntilAppointment <= (1.5 * 60 * 60 * 1000 + gracePeriod) &&
                    timeUntilAppointment >= (0.75 * 60 * 60 * 1000 - gracePeriod) &&
                    timeUntilAppointment > (windowEnd1h - ttl1h); // No expiró TTL

  if (canSend1h) {
    needed.push({ type: '1h', timestampField: 'reminderSentAt', priority: 1 });
  }

  // Registrar métricas de dropped messages
  if (dropped.length > 0) {
    schedulerMetrics.droppedMessages += dropped.length;
    console.log(`[ContextualScheduler] 🗑️ Load shedding: ${dropped.length} recordatorios descartados por backlog`);
  }

  return needed;
}

/**
 * Ejecuta el scheduler contextual
 * Se ejecuta cada minuto para evaluar qué mensajes enviar en tiempo real
 */
async function runContextualScheduler() {
  const runStartTime = Date.now();
  console.log('[ContextualScheduler] 🔄 Evaluando envíos basados en agenda real...');

  // Actualizar métricas de lag
  if (schedulerMetrics.lastRun) {
    schedulerMetrics.lagMs = runStartTime - schedulerMetrics.lastRun;
  }
  schedulerMetrics.lastRun = runStartTime;

  try {
    // Obtener todos los negocios activos
    const businesses = await Business.findAll({
      where: { status: 'active' }
    });

    let totalProcessed = 0;
    let totalSent = 0;
    let backlogCount = 0;

    // Determinar estado de backlog para load shedding
    const backlogStatus = schedulerMetrics.backlog > 50 ? 'critical' : 'normal';

    for (const business of businesses) {
      // Verificar límites de actividad (async con análisis histórico)
      const limits = await getBusinessHourlyLimit(business.id);
      if (!limits.canSend) {
        console.log(`[ContextualScheduler] ⏸️ Negocio ${business.id} alcanzó límite horario/diario (pattern: ${limits.patternMultiplier.toFixed(2)}x)`);
        continue;
      }

      // Verificar backpressure global
      if (!checkGlobalBackpressure()) {
        console.log(`[ContextualScheduler] ⏸️ Backpressure global activo, esperando...`);
        backlogCount += 10; // Estimación
        continue;
      }

      // Obtener citas del día
      const appointments = await getTodaysAppointmentsNeedingReminders(business.id);

      for (const appointment of appointments) {
        schedulerMetrics.lockContentionTotal++;
        
        // USAR LOCK DISTRIBUIDO para cada cita (previene race conditions entre instancias)
        const lockKey = `appointment:${appointment.id}:reminder`;
        const lockInfo = await acquireLockWithRetry(lockKey, 30000); // Lock TTL de 30 segundos
        
        if (!lockInfo.acquired) {
          schedulerMetrics.lockContentionCount++;
          console.log(`[ContextualScheduler] 🔒 Lock no adquirido para cita ${appointment.id}, otro proceso está manejándola`);
          continue;
        }

        // Iniciar heartbeat para renovar el lock periódicamente
        const heartbeat = createLockHeartbeat(lockKey, lockInfo.token, 10000, 30000);
        
        try {
          // Recargar la cita para obtener estado actual (con includes necesarios)
          const freshAppointment = await Appointment.findByPk(appointment.id, {
            include: [
              { model: Service },
              { model: Business }
            ]
          });
          if (!freshAppointment) {
            continue;
          }

          // Determinar qué recordatorios necesita (con load shedding si hay backlog)
          const neededReminders = determineNeededReminders(freshAppointment, backlogStatus);

          if (neededReminders.length === 0) {
            continue;
          }

          // Ordenar por prioridad (1=crítico, 2=importante, 3=flexible)
          neededReminders.sort((a, b) => a.priority - b.priority);

          let sent = false;

          for (const reminder of neededReminders) {
            // Verificar si podemos enviar más
            const currentLimits = await getBusinessHourlyLimit(business.id);
            if (!currentLimits.canSend) {
              console.log(`[ContextualScheduler] ⏸️ Límite alcanzado, priorizando recordatorios críticos`);
              break;
            }

            // Verificar actividad humana (chat en curso)
            const humanDelay = checkHumanActivityDelay(business.id);
            if (humanDelay > 0) {
              console.log(`[ContextualScheduler] 💬 Actividad humana reciente detectada, delay de ${Math.round(humanDelay / 1000)}s para no interrumpir`);
              continue; // Saltar este envío, se reintentará en el próximo ciclo
            }

            // Calcular momento óptimo
            const delay = calculateOptimalSendTime(freshAppointment, reminder.type);

            // Fallback para recordatorios críticos: si delay > 30 min, evaluar opciones
            const isCritical = reminder.priority <= 2; // 1h o 2h
            if (isCritical && delay > CONTEXTUAL_CONFIG.CRITICAL_REMINDER_MAX_DELAY_MS) {
              if (CONTEXTUAL_CONFIG.ENABLE_REDUCED_CRITICAL_MESSAGES) {
                console.log(`[ContextualScheduler] ⚠️ Recordatorio crítico ${reminder.type} con delay excesivo (${Math.round(delay/60000)}min), enviando versión reducida`);
              } else {
                console.log(`[ContextualScheduler] 🗑️ Recordatorio crítico ${reminder.type} descartado por delay excesivo (${Math.round(delay/60000)}min)`);
                continue;
              }
            }

            if (delay !== null && delay <= 60 * 1000) {
              // 1. VERIFICAR PRIORIDAD: No enviar 12h/24h si ya se envió 1h/2h (rompe UX)
              const moreCriticalSent = await AppointmentReminderEvent.findOne({
                where: {
                  appointmentId: freshAppointment.id,
                  status: 'sent',
                  reminderType: { [Op.in]: ['1h', '2h'] } // Más críticos que 12h/24h
                }
              });
              
              if (moreCriticalSent && ['12h', '24h'].includes(reminder.type)) {
                console.log(`[ContextualScheduler] 🗑️ Saltando ${reminder.type} porque ya se envió recordatorio más crítico (1h/2h)`);
                continue;
              }

              // 2. IDEMPOTENCIA: Claim atómico con UPDATE...WHERE (evita race condition en zombies)
              const twoMinutesAgo = new Date(Date.now() - CONTEXTUAL_CONFIG.PROCESSING_TIMEOUT_MS);
              const workerId = `${process.pid}-${Date.now()}`;
              
              // Intentar claim atómico de evento existente (zombie o failed)
              const claimedEvent = await claimEventAtomically(
                freshAppointment.id,
                reminder.type,
                workerId,
                twoMinutesAgo
              );

              let eventId;
              
              if (claimedEvent) {
                // Verificar límite de reintentos
                if (claimedEvent.retryCount >= CONTEXTUAL_CONFIG.MAX_RETRIES) {
                  console.log(`[ContextualScheduler] 🚫 Máximo reintentos alcanzado (${CONTEXTUAL_CONFIG.MAX_RETRIES}) para cita ${freshAppointment.id}, tipo ${reminder.type}`);
                  continue;
                }
                
                // Verificar prioridad antes de reintentar (no enviar 12h si ya hay 1h sent)
                const moreCriticalSent = await AppointmentReminderEvent.findOne({
                  where: {
                    appointmentId: freshAppointment.id,
                    status: 'sent',
                    reminderType: { [Op.in]: ['1h', '2h'] }
                  }
                });
                
                if (moreCriticalSent && ['12h', '24h'].includes(reminder.type)) {
                  // Marcar como skipped para evitar reintentos inútiles
                  await AppointmentReminderEvent.update(
                    { 
                      status: 'skipped',
                      lastError: 'Skipped: lower priority after critical reminder sent'
                    },
                    { where: { id: claimedEvent.id } }
                  );
                  console.log(`[ContextualScheduler] �️ Marcando ${reminder.type} como skipped (baja prioridad después de crítico)`);
                  continue;
                }
                
                // Calcular backoff con jitter (evita thundering herd)
                const baseBackoff = CONTEXTUAL_CONFIG.RETRY_BACKOFF_MS[claimedEvent.retryCount] || 600000;
                const jitter = 0.8 + Math.random() * 0.4; // 0.8 - 1.2
                const backoffMs = Math.round(baseBackoff * jitter);
                const lastAttempt = claimedEvent.updatedAt || claimedEvent.createdAt;
                let timeSinceLastAttempt = Date.now() - new Date(lastAttempt).getTime();
                
                // FIX: Si hay desfase de reloj (DB > app), timeSinceLastAttempt puede ser negativo
                // En ese caso, asumir 0 (ya pasó el tiempo suficiente) para evitar esperas de horas
                if (timeSinceLastAttempt < 0) {
                  console.log(`[ContextualScheduler] ⚠️ Desfase de reloj detectado: lastAttempt=${lastAttempt} es futuro, ignorando backoff`);
                  timeSinceLastAttempt = 0;
                }
                
                if (timeSinceLastAttempt < backoffMs) {
                  // Liberar el claim si no podemos procesar aún
                  await AppointmentReminderEvent.update(
                    { processingBy: null, processingAt: null },
                    { where: { id: claimedEvent.id } }
                  );
                  console.log(`[ContextualScheduler] ⏸️ Backoff activo: esperando ${Math.round((backoffMs - timeSinceLastAttempt)/1000)}s más`);
                  continue;
                }
                
                eventId = claimedEvent.id;
                schedulerMetrics.retryCount++;
              } else {
                // No hay evento existente disponible → crear nuevo
                try {
                  const newEvent = await AppointmentReminderEvent.create({
                    appointmentId: freshAppointment.id,
                    businessId: business.id,
                    reminderType: reminder.type,
                    status: 'pending',
                    clientPhone: freshAppointment.clientPhone,
                    processId: workerId,
                    processingBy: workerId,
                    processingAt: new Date()
                  });
                  eventId = newEvent.id;
                } catch (error) {
                  // UNIQUE constraint violation → ya fue enviado por otro worker
                  if (error.name === 'SequelizeUniqueConstraintError' || 
                      (error.original && error.original.code === '23505')) {
                    schedulerMetrics.duplicateAvoided++;
                    schedulerMetrics.dbUniqueViolations++;
                    console.log(`[ContextualScheduler] 🔒 Duplicado evitado por DB UNIQUE constraint para cita ${freshAppointment.id}, tipo ${reminder.type}`);
                    break;
                  }
                  throw error;
                }
              }

              // Enviar mensaje con medición de latencia
              const sendStartTime = Date.now();
              try {
                await sendContextualReminder(
                  business.id, 
                  freshAppointment, 
                  reminder.type, 
                  isCritical && delay > CONTEXTUAL_CONFIG.CRITICAL_REMINDER_MAX_DELAY_MS
                );
                
                // Éxito: actualizar a 'sent' y limpiar processing
                const sendLatency = Date.now() - sendStartTime;
                await AppointmentReminderEvent.update(
                  { 
                    status: 'sent', 
                    sentAt: new Date(),
                    lastError: null,
                    processingBy: null,
                    processingAt: null
                  },
                  { where: { id: eventId } }
                );
                
                // Actualizar métricas
                await freshAppointment.update({ [reminder.timestampField]: new Date() });
                registerMessageSent(business.id);
                sent = true;
                totalSent++;
                schedulerMetrics.onTimeDelivery++;
                schedulerMetrics.totalSendLatencyMs += sendLatency;
                schedulerMetrics.sendCount++;
                schedulerMetrics.retrySuccess++;
                
                // Guardar latencia para percentiles (mantener últimas 1000)
                schedulerMetrics.recentLatencies.push(sendLatency);
                if (schedulerMetrics.recentLatencies.length > 1000) {
                  schedulerMetrics.recentLatencies.shift();
                }
                
                console.log(`[ContextualScheduler] ✅ Recordatorio ${reminder.type} enviado en ${sendLatency}ms para cita ${freshAppointment.id}`);
                break; // Solo enviar un recordatorio por cita por ciclo
                
              } catch (sendError) {
                // Fallo de envío: actualizar a 'failed' y limpiar processing para reintento
                const sendLatency = Date.now() - sendStartTime;
                await AppointmentReminderEvent.update(
                  { 
                    status: 'failed',
                    lastError: sendError.message.substring(0, 500),
                    processingBy: null,
                    processingAt: null
                  },
                  { where: { id: eventId } }
                );
                
                schedulerMetrics.sendFailures++;
                schedulerMetrics.totalSendLatencyMs += sendLatency;
                schedulerMetrics.sendCount++;
                
                console.error(`[ContextualScheduler] ❌ Fallo enviando recordatorio ${reminder.type} (${sendLatency}ms):`, sendError.message);
                // Continuar al siguiente reminder si hay más
              }
            }
          }
        } finally {
          // Detener heartbeat y liberar lock
          heartbeat.stop();
          await releaseLock(lockKey, lockInfo.token);
        }

        totalProcessed++;
      }
    }

    // Actualizar métricas
    schedulerMetrics.backlog = backlogCount;
    schedulerMetrics.totalProcessed += totalProcessed;

    // Calcular porcentaje de entrega a tiempo
    const onTimePct = schedulerMetrics.totalProcessed > 0
      ? (schedulerMetrics.onTimeDelivery / schedulerMetrics.totalProcessed * 100).toFixed(1)
      : 0;

    console.log(`[ContextualScheduler] 📊 Procesadas ${totalProcessed} citas, ${totalSent} recordatorios enviados, backlog: ${backlogCount}, onTime: ${onTimePct}%`);
    return { processed: totalProcessed, sent: totalSent, backlog: backlogCount };

  } catch (error) {
    console.error('[ContextualScheduler] ❌ Error:', error.message);
    return { error: error.message };
  }
}

/**
 * Envía un recordatorio contextual
 * @param {boolean} useReducedMessage - Si es true, envía versión reducida (para recordatorios críticos con delay excesivo)
 */
async function sendContextualReminder(businessId, appointment, reminderType, useReducedMessage = false) {
  // Validación de appointment
  if (!appointment) {
    throw new Error('Appointment es undefined o null');
  }
  if (!appointment.Service) {
    throw new Error(`Appointment ${appointment.id} no tiene Service cargado (¿falta include?)`);
  }
  if (!appointment.Business) {
    throw new Error(`Appointment ${appointment.id} no tiene Business cargado (¿falta include?)`);
  }
  
  const { generateConfirmedReminder24h, generateUnconfirmedReminder24h,
          generateConfirmedReminder12h, generateUnconfirmedReminder12h,
          generateConfirmedReminder2h, generateUnconfirmedReminder2h,
          generateReminder1h } = require('../reminder/message.generators');
  
  const timeStr = new Date(appointment.startTime).toLocaleTimeString('es-CO', { 
    timeStyle: 'short', 
    timeZone: 'America/Bogota' 
  });
  
  let message;
  const isConfirmed = appointment.status === 'confirmed' || appointment.confirmed;
  
  // Si es mensaje reducido por delay excesivo, usar versión simplificada
  if (useReducedMessage) {
    const clientName = appointment.clientName || 'Cliente';
    const serviceName = appointment.Service?.name || 'su cita';
    const businessName = appointment.Business?.name || 'nuestro negocio';
    
    message = `⏰ *${clientName}*, recordatorio urgente: tienes ${serviceName} en ${businessName} a las *${timeStr}*. ¡Nos vemos pronto!`;
  } else {
    switch (reminderType) {
      case '24h':
        message = isConfirmed 
          ? generateConfirmedReminder24h(appointment, timeStr)
          : generateUnconfirmedReminder24h(appointment, timeStr);
        break;
      case '12h':
        const dayText = getRelativeDayText(appointment.startTime);
        message = isConfirmed
          ? generateConfirmedReminder12h(appointment, dayText)
          : generateUnconfirmedReminder12h(appointment, dayText);
        break;
      case '2h':
        message = isConfirmed
          ? generateConfirmedReminder2h(appointment, timeStr)
          : generateUnconfirmedReminder2h(appointment, timeStr);
        break;
      case '1h':
        message = generateReminder1h(appointment, timeStr, isConfirmed);
        break;
      default:
        throw new Error(`Tipo de recordatorio desconocido: ${reminderType}`);
    }
  }
  
  // Enviar mensaje
  await whatsappService.sendMessageDirect(businessId, appointment.clientPhone, message);
}

/**
 * Obtiene texto relativo del día (hoy, mañana, etc.)
 */
function getRelativeDayText(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (date.toDateString() === now.toDateString()) {
    return 'hoy';
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return 'mañana';
  } else {
    return date.toLocaleDateString('es-CO', { weekday: 'long' });
  }
}

/**
 * Adquiere un lock con reintentos
 */
async function acquireLockWithRetry(key, ttlMs) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const lockInfo = await acquireLock(key, ttlMs);
    if (lockInfo.acquired) {
      return lockInfo;
    }
    if (attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return { acquired: false, token: null };
}

/**
 * Claim atómico de evento zombie o failed
 * Usa UPDATE...WHERE para evitar race conditions entre workers
 * Retorna el evento claimado o null si otro worker lo tomó primero
 */
async function claimEventAtomically(appointmentId, reminderType, workerId, timeoutThreshold) {
  try {
    // Intentar claim atómico con UPDATE...WHERE
    const [affectedRows] = await AppointmentReminderEvent.update(
      {
        processingBy: workerId,
        processingAt: new Date(),
        retryCount: sequelize.literal('"retryCount" + 1'),
        processId: workerId,
        status: 'pending',
        lastError: null
      },
      {
        where: {
          appointmentId: appointmentId,
          reminderType: reminderType,
          [Op.or]: [
            { status: 'failed' },
            {
              status: 'pending',
              [Op.or]: [
                { processingAt: null },
                { processingAt: { [Op.lt]: timeoutThreshold } }
              ]
            }
          ],
          // Condición adicional: no está siendo procesado por otro worker recientemente
          [Op.or]: [
            { processingBy: null },
            { processingAt: { [Op.lt]: timeoutThreshold } }
          ]
        },
        returning: true, // PostgreSQL devuelve las filas actualizadas
        plain: false
      }
    );

    if (affectedRows === 0) {
      return null; // Otro worker ya lo tomó
    }

    // Recuperar el evento actualizado
    const claimedEvent = await AppointmentReminderEvent.findOne({
      where: {
        appointmentId: appointmentId,
        reminderType: reminderType,
        processingBy: workerId
      }
    });

    return claimedEvent;
  } catch (error) {
    console.error('[ContextualScheduler] ❌ Error en claim atómico:', error.message);
    return null;
  }
}

/**
 * Limpia eventos de recordatorio antiguos (más de 90 días)
 * Usa batch delete para evitar locks largos en la DB
 */
async function cleanupOldReminderEvents() {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    let totalDeleted = 0;
    let batchDeleted = 0;
    
    do {
      // Buscar IDs a eliminar (batch de 1000)
      const eventsToDelete = await AppointmentReminderEvent.findAll({
        where: {
          createdAt: { [Op.lt]: ninetyDaysAgo }
        },
        attributes: ['id'],
        limit: CONTEXTUAL_CONFIG.CLEANUP_BATCH_SIZE,
        raw: true
      });
      
      if (eventsToDelete.length === 0) break;
      
      // Eliminar por IDs (más eficiente y menos locking)
      const ids = eventsToDelete.map(e => e.id);
      batchDeleted = await AppointmentReminderEvent.destroy({
        where: { id: { [Op.in]: ids } }
      });
      
      totalDeleted += batchDeleted;
      
      // Pausa breve entre batches para no saturar DB
      if (batchDeleted === CONTEXTUAL_CONFIG.CLEANUP_BATCH_SIZE) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } while (batchDeleted === CONTEXTUAL_CONFIG.CLEANUP_BATCH_SIZE);
    
    if (totalDeleted > 0) {
      console.log(`[ContextualScheduler] 🧹 ${totalDeleted} eventos antiguos eliminados (>90 días)`);
    }
  } catch (error) {
    console.error('[ContextualScheduler] ❌ Error limpiando eventos antiguos:', error.message);
  }
}

// Limpiar eventos antiguos cada 24 horas
setInterval(cleanupOldReminderEvents, 24 * 60 * 60 * 1000);

/**
 * Retorna métricas del scheduler para monitoreo (/api/health)
 * Incluye métricas de concurrencia para detectar problemas reales
 */
function getSchedulerMetrics() {
  const now = Date.now();
  const onTimePct = schedulerMetrics.totalProcessed > 0
    ? (schedulerMetrics.onTimeDelivery / schedulerMetrics.totalProcessed * 100).toFixed(1)
    : 0;

  // Calcular tasa de contención de locks (proporción de intentos fallidos)
  const lockContentionRate = schedulerMetrics.lockContentionTotal > 0
    ? (schedulerMetrics.lockContentionCount / schedulerMetrics.lockContentionTotal).toFixed(3)
    : 0;

  // Calcular latencia promedio de envío
  const avgSendLatencyMs = schedulerMetrics.sendCount > 0
    ? Math.round(schedulerMetrics.totalSendLatencyMs / schedulerMetrics.sendCount)
    : 0;

  // Calcular percentiles de latencia (p95, p99)
  const latencies = schedulerMetrics.recentLatencies.slice().sort((a, b) => a - b);
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] || 0 : 0;
  const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] || 0 : 0;

  // Calcular retry success rate
  const retrySuccessRate = schedulerMetrics.retryCount > 0
    ? (schedulerMetrics.retrySuccess / schedulerMetrics.retryCount).toFixed(2)
    : 1.0;

  return {
    // Métricas básicas
    lagMs: schedulerMetrics.lagMs,
    backlog: schedulerMetrics.backlog,
    droppedMessages: schedulerMetrics.droppedMessages,
    onTimeDeliveryPct: parseFloat(onTimePct),
    totalProcessed: schedulerMetrics.totalProcessed,
    lastRun: schedulerMetrics.lastRun,
    lastRunAgo: schedulerMetrics.lastRun ? now - schedulerMetrics.lastRun : null,
    healthy: schedulerMetrics.lastRun && (now - schedulerMetrics.lastRun) < 5 * 60 * 1000,
    
    // Métricas de concurrencia (detectan problemas reales)
    duplicateAvoided: schedulerMetrics.duplicateAvoided,
    lockContentionRate: parseFloat(lockContentionRate),
    lockContentionCount: schedulerMetrics.lockContentionCount,
    lockContentionTotal: schedulerMetrics.lockContentionTotal,
    dbUniqueViolations: schedulerMetrics.dbUniqueViolations,
    redisAvailable: redisInitialized,
    
    // Métricas de observabilidad (detectan problemas de UX)
    sendFailures: schedulerMetrics.sendFailures,
    retryCount: schedulerMetrics.retryCount,
    retrySuccessRate: parseFloat(retrySuccessRate),
    avgSendLatencyMs: avgSendLatencyMs,
    p95SendLatencyMs: p95,
    p99SendLatencyMs: p99,
    totalSends: schedulerMetrics.sendCount
  };
}

module.exports = {
  runContextualScheduler,
  getBusinessHourlyLimit,
  registerMessageSent,
  registerHumanActivity,
  calculateOptimalSendTime,
  getSchedulerMetrics
};
