const { ScheduledMessage, Business, WhatsAppSession, IncomingMessage, Appointment, sequelize } = require('../models');
const { Op } = require('sequelize');
const whatsappService = require('./evolutionService');

/**
 * Servicio de programación de mensajes de WhatsApp
 * Procesa mensajes en cola de forma eficiente para múltiples negocios
 * con conexión/desconexión bajo demanda para optimizar RAM
 */

// Control de procesamiento
let isProcessing = false;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 60000; // 1 minuto entre reintentos

// Tracker de timestamps por negocio para límite de velocidad (anti-bloqueo)
const messageTimestampsByBusiness = new Map();

// Tracker de warm-up por número de WhatsApp (ramp-up progresivo)
const whatsappWarmUpTracker = new Map(); // businessId -> { createdAt, messageCount }

/**
 * Obtiene el límite de mensajes por minuto basado en warm-up del número
 * Números nuevos tienen límites más estrictos para evitar bloqueos
 */
function getWarmUpLimit(businessId) {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (!whatsappWarmUpTracker.has(businessId)) {
    // Primer uso del número: registrar y aplicar límite estricto
    whatsappWarmUpTracker.set(businessId, { createdAt: now, messageCount: 0 });
    return 2; // Día 1: max 2 msgs/min
  }

  const warmUpData = whatsappWarmUpTracker.get(businessId);
  const daysSinceCreation = (now - warmUpData.createdAt) / DAY_MS;

  // Ramp-up progresivo
  if (daysSinceCreation < 1) {
    return 2; // Día 1: max 2 msgs/min
  } else if (daysSinceCreation < 3) {
    return 3; // Días 2-3: max 3 msgs/min
  } else if (daysSinceCreation < 7) {
    return 4; // Días 4-7: max 4 msgs/min
  } else {
    return MAX_MESSAGES_PER_MINUTE; // Después de 7 días: límite normal
  }
}

/**
 * Incrementa contador de mensajes para warm-up
 */
function incrementWarmUpCount(businessId) {
  if (whatsappWarmUpTracker.has(businessId)) {
    const data = whatsappWarmUpTracker.get(businessId);
    data.messageCount++;
    whatsappWarmUpTracker.set(businessId, data);
  }
}

/**
 * Genera delay con distribución sesgada (no uniforme) para comportamiento más humano
 * Usa Math.pow(Math.random(), 2) para generar más valores bajos y pocos altos
 */
function getHumanLikeDelay(minMs, maxMs) {
  const range = maxMs - minMs;
  // Distribución sesgada: más valores cerca del mínimo, pocos cerca del máximo
  const skewedRandom = Math.pow(Math.random(), 2);
  return minMs + skewedRandom * range;
}

/**
 * Verifica y aplica límite de velocidad por negocio (anti-bloqueo WhatsApp)
 * Usa warm-up dinámico para números nuevos
 * Retorna el delay adicional necesario para respetar el límite
 */
function checkRateLimit(businessId) {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;

  // Obtener límite dinámico basado en warm-up del número
  const dynamicLimit = getWarmUpLimit(businessId);

  if (!messageTimestampsByBusiness.has(businessId)) {
    messageTimestampsByBusiness.set(businessId, []);
  }

  const timestamps = messageTimestampsByBusiness.get(businessId);

  // Limpiar timestamps viejos (más de 1 minuto)
  const recentTimestamps = timestamps.filter(ts => ts > oneMinuteAgo);
  messageTimestampsByBusiness.set(businessId, recentTimestamps);

  // Si ya envió el límite dinámico en el último minuto, calcular delay
  if (recentTimestamps.length >= dynamicLimit) {
    const oldestTimestamp = recentTimestamps[0];
    const timeUntilOldestExpires = oldestTimestamp + 60 * 1000 - now;
    if (timeUntilOldestExpires > 0) {
      console.log(`[Scheduler] ⏸️ Rate limit para ${businessId}: esperando ${Math.round(timeUntilOldestExpires / 1000)}s para respetar límite de ${dynamicLimit} msgs/min (warm-up)`);
      return timeUntilOldestExpires;
    }
  }

  // Registrar este mensaje
  recentTimestamps.push(now);
  messageTimestampsByBusiness.set(businessId, recentTimestamps);

  // Incrementar contador de warm-up
  incrementWarmUpCount(businessId);

  return 0; // No hay delay adicional
}

// === Constantes de optimización para escala (200 negocios) ===
// Valores conservadores para evitar bloqueos de WhatsApp
const BATCH_LIMIT = 1000;              // Máximo mensajes por ciclo (antes 100)
const CONCURRENT_BUSINESSES = 5;       // Negocios procesados en paralelo
const BUSINESS_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutos timeout por negocio (antes 6 min)
const DELAY_BETWEEN_MESSAGES_MIN = 10000; // 10s mín entre mensajes (mismo negocio) - más seguro
const DELAY_BETWEEN_MESSAGES_MAX = 20000; // 20s máx entre mensajes (mismo negocio) - más seguro
const DELAY_BETWEEN_MESSAGES_HUMAN_MIN = 25000; // 25s para negocios con ≤3 msgs
const DELAY_BETWEEN_MESSAGES_HUMAN_MAX = 45000; // 45s para negocios con ≤3 msgs
const SYNC_WAIT_MS = 2000;             // 2s sincronización WhatsApp (antes 5s)
const DELAY_BETWEEN_BATCHES = 5000;    // 5s entre lotes de negocios paralelos (antes 3s)
const RESPONSE_WAIT_MS = 0;            // No bloquear scheduler por respuestas (antes 5 min)
const MAX_MESSAGES_PER_MINUTE = 3;    // Máximo 3 mensajes por minuto por negocio (anti-bloqueo)
const HUMAN_PAUSE_INTERVAL = 15;       // Pausa human-like cada 15 mensajes
const HUMAN_PAUSE_MIN_MS = 2 * 60 * 1000; // 2 minutos mínimo de pausa
const HUMAN_PAUSE_MAX_MS = 5 * 60 * 1000; // 5 minutos máximo de pausa

/**
 * Verifica si es horario laboral en Colombia (7:00 AM - 11:00 PM)
 * WhatsApp puede bloquear números que envían fuera de horarios normales
 * Colombia es UTC-5 (todo el año, no tiene horario de verano)
 * NOTA: Horario extendido hasta las 11 PM para pruebas
 */
function isBusinessHours() {
  const now = new Date();
  const colombiaOffset = -5 * 60 * 60 * 1000;
  const colombiaTime = new Date(now.getTime() + colombiaOffset);
  const hour = colombiaTime.getUTCHours();
  return hour >= 7 && hour < 23; // 7:00 AM - 11:00 PM Colombia (extendido para pruebas)
}

/**
 * Ajusta una fecha programada para que caiga dentro del horario laboral
 * Horario laboral: 7:00 AM - 11:00 PM Colombia (extendido para pruebas)
 * Si es antes de las 7:00 AM, programa a las 7:00 AM del mismo día
 * Si es después de las 11:00 PM, programa a las 7:00 AM del día siguiente
 */
function adjustToBusinessHours(date) {
  const colombiaOffset = -5 * 60 * 60 * 1000;

  // Calcular hora en Colombia (usando UTC hours del tiempo ajustado)
  const colombiaTime = new Date(date.getTime() + colombiaOffset);
  const hourInColombia = colombiaTime.getUTCHours();

  // Crear copia para no modificar la original
  const adjusted = new Date(date);

  // Horario laboral Colombia: 7:00 AM (07:00) a 11:00 PM (23:00) - extendido para pruebas
  // En UTC: 12:00 a 04:00 del día siguiente

  if (hourInColombia < 7) {
    // Antes de las 7:00 AM Colombia, ajustar a 7:00 AM de hoy
    // 7:00 AM Colombia = 12:00 UTC
    const targetUTC = new Date(colombiaTime);
    targetUTC.setUTCHours(12, 0, 0, 0);

    adjusted.setTime(targetUTC.getTime() - colombiaOffset);
    console.log(`[Scheduler] ⏰ Hora ajustada de ${hourInColombia}:00 a 7:00 AM (inicio horario laboral)`);
  } else if (hourInColombia >= 23) {
    // Después de las 11:00 PM Colombia, ajustar a 7:00 AM del día siguiente
    // 7:00 AM Colombia del día siguiente = 12:00 UTC del día siguiente
    const targetUTC = new Date(colombiaTime);
    targetUTC.setUTCDate(targetUTC.getUTCDate() + 1);
    targetUTC.setUTCHours(12, 0, 0, 0);

    adjusted.setTime(targetUTC.getTime() - colombiaOffset);
    console.log(`[Scheduler] ⏰ Hora ajustada de ${hourInColombia}:00 a 7:00 AM del día siguiente`);
  }
  // Si está entre 7:00 AM y 11:00 PM Colombia, no ajustar

  return adjusted;
}

/**
 * Obtiene mensajes pendientes agrupados por negocio
 * Optimizado para procesar en lotes eficientes
 */
async function getPendingMessagesGrouped() {
  const now = new Date();

  console.log(`[Scheduler] 🔍 Buscando mensajes pendientes...`);
  console.log(`[Scheduler]    - Ahora (UTC): ${now.toISOString()}`);
  console.log(`[Scheduler]    - Ahora (COL): ${new Date(now.getTime() - 5*60*60*1000).toISOString().replace('Z', '-05:00')}`);

  // Buscar mensajes pending que deberían enviarse ya
  const messages = await ScheduledMessage.findAll({
    where: {
      status: 'pending',
      scheduledAt: { [Op.lte]: now },
      retryCount: { [Op.lt]: MAX_RETRIES }
    },
    order: [['scheduledAt', 'ASC'], ['businessId', 'ASC']],
    limit: BATCH_LIMIT // Procesar máximo 1000 mensajes por ciclo
  });

  console.log(`[Scheduler] 🔍 Mensajes encontrados: ${messages.length}`);

  if (messages.length > 0) {
    messages.forEach(msg => {
      console.log(`[Scheduler]    - ID: ${msg.id}, Tipo: ${msg.type}, scheduledAt: ${msg.scheduledAt}, Phone: ${msg.phone}`);
    });
  }

  // Agrupar por negocio
  const grouped = {};
  for (const msg of messages) {
    if (!grouped[msg.businessId]) {
      grouped[msg.businessId] = [];
    }
    grouped[msg.businessId].push(msg);
  }

  return grouped;
}

/**
 * Procesa mensajes de un negocio específico
 * Conecta WhatsApp, envía mensajes, desconecta
 */
async function processBusinessMessages(businessId, messages) {
  console.log(`[Scheduler] 📦 Procesando ${messages.length} mensajes para negocio ${businessId}`);

  // Timeout global para todo el procesamiento de un negocio (20 minutos máximo)
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: procesamiento de negocio excedió ${BUSINESS_TIMEOUT_MS / 60000} minutos`)), BUSINESS_TIMEOUT_MS)
  );

  try {
    // Correr todo el procesamiento con timeout
    return await Promise.race([processBusinessMessagesInternal(businessId, messages), timeoutPromise]);
  } catch (error) {
    console.error(`[Scheduler] ❌ Timeout o error procesando negocio ${businessId}:`, error.message);

    // Asegurar desconexión en caso de timeout (Desactivado para Evolution API)
    // try {
    //   await whatsappService.stopInstance(businessId);
    // } catch (e) {}

    // Incrementar retry count de mensajes pendientes
    for (const msg of messages) {
      const newRetryCount = msg.retryCount + 1;
      await msg.update({
        retryCount: newRetryCount,
        errorMessage: error.message,
        status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending'
      });
    }

    return { success: false, reason: error.message, messagesKept: messages.length };
  }
}

/**
 * Procesamiento interno de mensajes de un negocio (sin timeout wrapper)
 */
async function processBusinessMessagesInternal(businessId, messages) {
  try {
    // 1. Verificar que la instancia existe en Evolution API y tiene sesión válida
    console.log(`[Scheduler] 🔍 Verificando instancia para ${businessId}...`);
    const hasValidSession = await whatsappService.hasValidSession(businessId);
    
    if (!hasValidSession) {
      console.log(`[Scheduler] ⚠️ Negocio ${businessId} no tiene sesión válida o instancia no existe en Evolution API, saltando (mensajes permanecen en pending)...`);
      // NO marcar mensajes como failed - dejarlos en pending para el próximo ciclo
      // cuando el negocio vuelva a conectar WhatsApp
      return { success: false, reason: 'no_session', messagesKept: messages.length };
    }

    // 2. Verificar sesión en BD
    const session = await WhatsAppSession.findOne({
      where: { businessId, status: 'connected' }
    });

    if (!session) {
      console.log(`[Scheduler] ⚠️ Negocio ${businessId} no tiene sesión activa en BD, actualizando...`);
      // Actualizar BD para reflejar el estado real
      try {
        const instanceInfo = await whatsappService.getInstanceInfo(businessId);
        if (instanceInfo) {
          await WhatsAppSession.upsert({
            businessId,
            status: 'connected',
            phoneNumber: instanceInfo.phoneNumber || null,
            profileName: instanceInfo.profileName || null,
            connectedAt: new Date(),
            lastActivity: new Date()
          });
          console.log(`[Scheduler] ✅ Sesión actualizada en BD para ${businessId}`);
        }
      } catch (e) {
        console.warn(`[Scheduler] ⚠️ No se pudo actualizar sesión en BD:`, e.message);
      }
    }

    // 3. Conectar WhatsApp (crear instancia temporal)
    console.log(`[Scheduler] 🔌 Conectando WhatsApp para ${businessId}...`);
    let client;
    try {
      client = await whatsappService.createInstance(businessId);
      console.log(`[Scheduler] ✅ WhatsApp conectado para ${businessId}`);
      
      // Esperar a que WhatsApp se sincronice completamente (2 segundos)
      console.log(`[Scheduler] ⏳ Esperando sincronización de WhatsApp...`);
      await new Promise(resolve => setTimeout(resolve, SYNC_WAIT_MS));
      console.log(`[Scheduler] ✅ Sincronización completa`);
      
      // Los mensajes entrantes se procesan UNA sola vez al inicio del ciclo global
      // para no repetir trabajo en paralelo. Ver runScheduler().
      
      console.log(`[Scheduler] ✅ Listo para enviar mensajes programados`);
    } catch (connError) {
      console.error(`[Scheduler] ❌ Error conectando WhatsApp para ${businessId}:`, connError.message);
      // Reintentar más tarde
      for (const msg of messages) {
        await msg.update({ 
          retryCount: msg.retryCount + 1,
          errorMessage: connError.message
        });
      }
      return { success: false, reason: 'connection_failed' };
    }

    // 4. Enviar mensajes con delays adaptativos entre ellos
    let sentCount = 0;
    let failedCount = 0;

    // Delay adaptativo: más rápido si hay muchos mensajes, más lento si son pocos
    const useHumanDelay = messages.length <= 3;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      try {
        if (i > 0) {
          // Pausa human-like cada HUMAN_PAUSE_INTERVAL mensajes para romper patrones
          if (i > 0 && i % HUMAN_PAUSE_INTERVAL === 0) {
            const humanPause = getHumanLikeDelay(HUMAN_PAUSE_MIN_MS, HUMAN_PAUSE_MAX_MS);
            console.log(`[Scheduler] 🧘 Pausa human-like (${Math.round(humanPause / 1000)}s) después de ${HUMAN_PAUSE_INTERVAL} mensajes para romper patrones...`);
            await new Promise(resolve => setTimeout(resolve, humanPause));
          }

          // Verificar límite de velocidad (anti-bloqueo)
          const rateLimitDelay = checkRateLimit(businessId);

          // Delay base adaptativo con distribución sesgada (no uniforme)
          const baseDelay = useHumanDelay
            ? getHumanLikeDelay(DELAY_BETWEEN_MESSAGES_HUMAN_MIN, DELAY_BETWEEN_MESSAGES_HUMAN_MAX)
            : getHumanLikeDelay(DELAY_BETWEEN_MESSAGES_MIN, DELAY_BETWEEN_MESSAGES_MAX);

          // Usar el mayor de los dos delays
          const totalDelay = Math.max(baseDelay, rateLimitDelay);
          console.log(`[Scheduler] ⏱️ Esperando ${Math.round(totalDelay/1000)}s antes del siguiente mensaje...`);
          await new Promise(resolve => setTimeout(resolve, totalDelay));
        } else {
          // Primer mensaje: verificar rate limit antes de enviar
          checkRateLimit(businessId);
        }

        // Enviar mensaje directamente (sin pasar por la cola antigua)
        console.log(`[Scheduler] 📤 Enviando mensaje ${msg.id} via Evolution API...`);
        await whatsappService.sendMessageDirect(businessId, msg.phone, msg.message);

        // Marcar como enviado
        await msg.update({
          status: 'sent',
          sentAt: new Date(),
          errorMessage: null // Limpiar errores previos si los había
        });

        sentCount++;
        console.log(`[Scheduler] ✅ Mensaje enviado: ${msg.id} a ${msg.phone}`);

      } catch (sendError) {
        console.error(`[Scheduler] ❌ Error enviando mensaje ${msg.id}:`, sendError.message);
        
        // Incrementar contador de reintentos
        const newRetryCount = msg.retryCount + 1;
        await msg.update({
          retryCount: newRetryCount,
          errorMessage: sendError.message,
          status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending'
        });
        
        failedCount++;
      }
    }

    // 5. Verificar si hay mensajes que esperan respuesta (rating, review, confirmation)
    // Si los hay, mantener conexión para recibir respuestas
    const hasAwaitingResponse = messages.some(m => 
      m.type === 'rating' || 
      m.type === 'review' || 
      m.type === 'confirmation' ||
      m.type === 'custom' // Mensajes de confirmación de cita
    );
    
    if (hasAwaitingResponse) {
      console.log(`[Scheduler] ℹ️ Hay mensajes que esperan respuesta (calificación/confirmación), manteniendo conexión`);
      // NO desconectar - dejar la conexión activa para recibir respuestas
    } else {
      // 5. Desconectar WhatsApp (no bloqueamos el scheduler por respuestas)
      // Las respuestas se procesarán en el siguiente ciclo de scheduler
      if (RESPONSE_WAIT_MS > 0) {
        console.log(`[Scheduler] ⏳ Mensajes esperan respuesta. Manteniendo conexión ${RESPONSE_WAIT_MS / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, RESPONSE_WAIT_MS));
      }
      
      // console.log(`[Scheduler] 🔌 Desconectando WhatsApp para ${businessId}...`);
      // try {
      //   await whatsappService.stopInstance(businessId);
      //   console.log(`[Scheduler] ✅ WhatsApp desconectado para ${businessId}`);
      // } catch (disconnectError) {
      //   console.warn(`[Scheduler] ⚠️ Error desconectando (no crítico):`, disconnectError.message);
      // }
    }

    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
      total: messages.length
    };

  } catch (error) {
    console.error(`[Scheduler] ❌ Error general procesando negocio ${businessId}:`, error.message);

    // Asegurar desconexión en caso de error (Desactivado para Evolution API)
    // try {
    //   await whatsappService.stopInstance(businessId);
    // } catch (e) {}

    throw error; // Re-lanzar para que el timeout wrapper lo maneje
  }
}

/**
 * Función principal del scheduler
 * Ejecutar cada 5 minutos via cron
 */
async function runScheduler() {
  const SCHEDULER_OVERLAP_MS = 14 * 60 * 1000; // 14 minutos (menor que el intervalo de 15 min)

  // Evitar ejecuciones concurrentes reales
  if (isProcessing) {
    const processingTime = Date.now() - (global.schedulerStartTime || 0);
    console.log(`[Scheduler] ⏳ Procesamiento anterior en curso (${Math.round(processingTime / 1000)}s)...`);
    if (processingTime > SCHEDULER_OVERLAP_MS) {
      console.warn(`[Scheduler] ⚠️ Procesamiento anterior lleva ${Math.round(processingTime / 1000)}s, forzando reset...`);
      isProcessing = false;
    } else {
      return { status: 'skipped', reason: 'already_processing', elapsedMs: processingTime };
    }
  }

  global.schedulerStartTime = Date.now();
  isProcessing = true;

  // Verificar horario laboral Colombia
  if (!isBusinessHours()) {
    const now = new Date();
    const colombiaOffset = -5 * 60 * 60 * 1000;
    const colombiaTime = new Date(now.getTime() + colombiaOffset);
    const hour = colombiaTime.getUTCHours();

    console.log(`[Scheduler] ⏰ Fuera de horario laboral Colombia (${hour}:00). Mensajes quedarán en cola.`);
    isProcessing = false;
    return {
      status: 'paused',
      reason: 'outside_business_hours',
      colombiaHour: hour
    };
  }

  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    businesses: []
  };

  try {
    console.log('[Scheduler] 🚀 Iniciando procesamiento de cola...');

    // === PASO 0: Procesar mensajes entrantes globales UNA sola vez ===
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const allPendingIncoming = await IncomingMessage.findAll({
        where: { status: 'pending', createdAt: { [Op.gte]: oneWeekAgo } },
        order: [['createdAt', 'ASC']],
        limit: 200
      });
      if (allPendingIncoming.length > 0) {
        console.log(`[Scheduler] 📨 ${allPendingIncoming.length} mensajes entrantes pendientes globales`);
        // Agrupar por negocio y procesar con cualquier cliente disponible
        const incomingByBusiness = {};
        for (const msg of allPendingIncoming) {
          if (!incomingByBusiness[msg.businessId]) incomingByBusiness[msg.businessId] = [];
          incomingByBusiness[msg.businessId].push(msg);
        }
        for (const [bizId, msgs] of Object.entries(incomingByBusiness)) {
          if (whatsappService.hasValidSession(bizId)) {
            try {
              const client = await whatsappService.createInstance(bizId);
              for (const msg of msgs.slice(0, 50)) {
                try {
                  const appointments = await Appointment.findAll({
                    where: {
                      businessId: bizId,
                      clientPhone: { [Op.like]: `%${msg.phone}%` },
                      status: { [Op.in]: ['pending', 'confirmed', 'attention', 'done'] }
                    },
                    order: [['startTime', 'DESC']]
                  });
                  if (appointments.length > 0) {
                    const { handleClientResponse } = require('./evolutionService');
                    await handleClientResponse(bizId, client, {
                      body: msg.message,
                      from: msg.phone,
                      id: { _serialized: msg.whatsappMessageId }
                    });
                    await msg.update({ status: 'processed', processedAt: new Date() });
                  } else {
                    await msg.update({ status: 'failed', errorMessage: 'No se encontraron citas', retryCount: msg.retryCount + 1 });
                  }
                } catch (e) {
                  await msg.update({ status: 'failed', errorMessage: e.message, retryCount: msg.retryCount + 1 });
                }
                await new Promise(r => setTimeout(r, 1000));
              }
              // try { await whatsappService.stopInstance(bizId); } catch (e) {}
            } catch (connErr) {
              console.error(`[Scheduler] ⚠️ Error conectando para mensajes entrantes ${bizId}:`, connErr.message);
            }
          }
        }
      }
    } catch (incomingErr) {
      console.error('[Scheduler] ⚠️ Error procesando mensajes entrantes globales:', incomingErr.message);
    }

    // Obtener mensajes agrupados por negocio
    const groupedMessages = await getPendingMessagesGrouped();
    const businessIds = Object.keys(groupedMessages);

    if (businessIds.length === 0) {
      console.log('[Scheduler] ℹ️ No hay mensajes programados pendientes');
      isProcessing = false;
      return { status: 'success', processed: 0, message: 'No pending messages' };
    }

    console.log(`[Scheduler] 📊 ${businessIds.length} negocios con mensajes programados pendientes`);

    // === Procesar negocios en lotes paralelos de CONCURRENT_BUSINESSES ===
    for (let i = 0; i < businessIds.length; i += CONCURRENT_BUSINESSES) {
      const batch = businessIds.slice(i, i + CONCURRENT_BUSINESSES);
      console.log(`[Scheduler] 🔄 Procesando lote ${Math.floor(i / CONCURRENT_BUSINESSES) + 1}: ${batch.join(', ')}`);

      // Ejecutar en paralelo los negocios del lote
      const batchResults = await Promise.all(
        batch.map(async (businessId) => {
          const messages = groupedMessages[businessId];
          console.log(`[Scheduler] ▶️ Procesando negocio ${businessId} (${messages.length} mensajes)`);
          const result = await processBusinessMessages(businessId, messages);
          return { businessId, ...result };
        })
      );

      // Acumular resultados
      for (const batchResult of batchResults) {
        results.businesses.push(batchResult);
        if (batchResult.sent) results.sent += batchResult.sent;
        if (batchResult.failed) results.failed += batchResult.failed;
        results.processed += groupedMessages[batchResult.businessId].length;
      }

      // Delay entre lotes para no saturar el servidor
      if (i + CONCURRENT_BUSINESSES < businessIds.length) {
        console.log(`[Scheduler] ⏱️ Esperando ${DELAY_BETWEEN_BATCHES / 1000}s antes del siguiente lote...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    console.log(`[Scheduler] ✅ Completado: ${results.sent} enviados, ${results.failed} fallidos`);
    return { status: 'success', ...results };

  } catch (error) {
    console.error('[Scheduler] ❌ Error crítico:', error.message);
    return { status: 'error', error: error.message };
  } finally {
    isProcessing = false;
    global.schedulerStartTime = null;
  }
}

/**
 * Programar un mensaje para ser enviado más tarde
 * @param {Object} params - Parámetros del mensaje
 * @param {string} params.businessId - ID del negocio
 * @param {string} params.appointmentId - ID de la cita vinculada
 * @param {string} params.phone - Teléfono destino
 * @param {string} params.message - Contenido del mensaje
 * @param {string} params.type - Tipo de mensaje (reminder, confirmation, rating, custom)
 * @param {Date} params.scheduledAt - Fecha/hora programada
 */
async function scheduleMessage({ businessId, appointmentId, phone, message, type, scheduledAt }) {
  try {
    console.log(`[Scheduler] 📅 Mensaje programado: ${type} para ${phone} a las ${scheduledAt}`);

    // Verificar si ya existe un mensaje del mismo tipo para esta cita (protección contra duplicados)
    if (appointmentId && type) {
      const existingMessage = await ScheduledMessage.findOne({
        where: {
          appointmentId,
          type,
          status: { [Op.in]: ['pending', 'sent'] }
        }
      });

      if (existingMessage) {
        console.log(`[Scheduler] ⚠️ Mensaje duplicado detectado: Ya existe un mensaje tipo '${type}' para cita ${appointmentId}. Saltando...`);
        return existingMessage;
      }
    }

    // Ajustar hora programada al horario laboral si es necesario
    const adjustedScheduledAt = adjustToBusinessHours(new Date(scheduledAt));

    console.log(`[Scheduler] 📅 Hora original: ${scheduledAt}`);
    console.log(`[Scheduler] 📅 Hora ajustada: ${adjustedScheduledAt}`);

    const scheduled = await ScheduledMessage.create({
      businessId,
      appointmentId,
      phone,
      message,
      type,
      scheduledAt: adjustedScheduledAt,
      status: 'pending',
      retryCount: 0
    });

    console.log(`[Scheduler] ✅ Mensaje guardado en BD: ${scheduled.id} con scheduledAt: ${scheduled.scheduledAt}`);
    return scheduled;
  } catch (error) {
    console.error('[Scheduler] ❌ Error programando mensaje:', error.message);
    throw error;
  }
}

/**
 * Cancela mensajes pendientes de una cita
 * Útil cuando se cancela una cita
 */
async function cancelAppointmentMessages(appointmentId) {
  try {
    const result = await ScheduledMessage.update(
      { status: 'cancelled' },
      {
        where: {
          appointmentId,
          status: { [Op.in]: ['pending', 'failed'] }
        }
      }
    );

    console.log(`[Scheduler] 🚫 ${result[0]} mensajes cancelados para cita ${appointmentId}`);
    return result[0];
  } catch (error) {
    console.error('[Scheduler] ❌ Error cancelando mensajes:', error.message);
    return 0;
  }
}

/**
 * Obtiene estadísticas de mensajes programados
 */
async function getStats(businessId = null) {
  const where = businessId ? { businessId } : {};
  
  const stats = await ScheduledMessage.findAll({
    where,
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true
  });

  return stats;
}


/**
 * Limpia mensajes antiguos de BD para evitar crecimiento indefinido.
 * Borra mensajes enviados/fallidos/cancelados/procesados con más de N días.
 */
async function cleanupOldMessages(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const scheduledDeleted = await ScheduledMessage.destroy({
      where: {
        status: { [Op.in]: ['sent', 'failed', 'cancelled'] },
        updatedAt: { [Op.lt]: cutoff }
      }
    });
    const incomingDeleted = await IncomingMessage.destroy({
      where: {
        status: { [Op.in]: ['processed', 'failed'] },
        updatedAt: { [Op.lt]: cutoff }
      }
    });
    if (scheduledDeleted > 0 || incomingDeleted > 0) {
      console.log(`[Scheduler Cleanup] 🧹 ${scheduledDeleted} ScheduledMessage + ${incomingDeleted} IncomingMessage eliminados (> ${days} días)`);
    }
    return { scheduledDeleted, incomingDeleted };
  } catch (error) {
    console.error('[Scheduler Cleanup] ❌ Error limpiando mensajes viejos:', error.message);
    return { scheduledDeleted: 0, incomingDeleted: 0, error: error.message };
  }
}

module.exports = {
  runScheduler,
  scheduleMessage,
  cancelAppointmentMessages,
  getStats,
  isBusinessHours,
  cleanupOldMessages
};
