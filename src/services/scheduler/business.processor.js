/**
 * Procesamiento de mensajes por negocio
 */
const whatsappService = require('../evolutionService');
const { CONFIG, RESPONSE_TYPES } = require('./config');

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
    return CONFIG.MAX_MESSAGES_PER_MINUTE; // Después de 7 días: límite normal
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

/**
 * Procesa mensajes de un negocio específico (con timeout)
 */
async function processBusinessMessages(businessId, messages) {
  console.log(`[Scheduler] 📦 Procesando ${messages.length} mensajes para negocio ${businessId}`);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: procesamiento de negocio excedió ${CONFIG.BUSINESS_TIMEOUT_MS / 60000} minutos`)), CONFIG.BUSINESS_TIMEOUT_MS)
  );

  try {
    return await Promise.race([processBusinessMessagesInternal(businessId, messages), timeoutPromise]);
  } catch (error) {
    console.error(`[Scheduler] ❌ Timeout o error procesando negocio ${businessId}:`, error.message);

    // No detener instancia en caso de error, dejar que el heartbeat lo maneje
    /*
    try {
      await whatsappService.stopInstance(businessId);
    } catch (e) {}
    */

    for (const msg of messages) {
      const newRetryCount = msg.retryCount + 1;
      await msg.update({
        retryCount: newRetryCount,
        errorMessage: error.message,
        status: newRetryCount >= CONFIG.MAX_RETRIES ? 'failed' : 'pending',
      });
    }

    return { success: false, reason: error.message, messagesKept: messages.length };
  }
}

/**
 * Procesamiento interno de mensajes (sin timeout wrapper)
 */
async function processBusinessMessagesInternal(businessId, messages) {
  try {
    // Resolver businessId para sucursales que usan WhatsApp del padre
    const { Business } = require('../../models');
    const resolvedBusinessId = await Business.resolveWhatsAppBusinessId(businessId);
    console.log(`[Scheduler] 🔍 Resolución businessId: ${businessId} -> ${resolvedBusinessId}`);
    if (resolvedBusinessId !== businessId) {
      console.log(`[Scheduler] 🔄 Resuelto businessId: ${businessId} -> ${resolvedBusinessId} (sucursal usando WhatsApp del padre)`);
    }

    const hasSession = await whatsappService.hasValidSession(resolvedBusinessId);
    if (!hasSession) {
      console.log(`[Scheduler] ⚠️ Negocio ${resolvedBusinessId} no tiene sesión válida en Evolution API, saltando...`);
      return { success: false, reason: 'no_session', messagesKept: messages.length };
    }

    let client;
    try {
      client = await whatsappService.createInstance(resolvedBusinessId);
      console.log(`[Scheduler] ✅ WhatsApp conectado para ${resolvedBusinessId}`);

      await new Promise(resolve => setTimeout(resolve, CONFIG.SYNC_WAIT_MS));
      console.log(`[Scheduler] ✅ Sincronización completa`);

      // Los mensajes entrantes se procesan globalmente en runScheduler(), no aquí
      // para evitar procesamiento duplicado en paralelo.

      console.log(`[Scheduler] ✅ Listo para enviar mensajes programados`);
    } catch (connError) {
      console.error(`[Scheduler] ❌ Error conectando WhatsApp para ${resolvedBusinessId}:`, connError.message);
      for (const msg of messages) {
        await msg.update({
          retryCount: msg.retryCount + 1,
          errorMessage: connError.message,
        });
      }
      return { success: false, reason: 'connection_failed' };
    }

    const result = await sendMessagesBatch(resolvedBusinessId, client, messages);

    // Desconectar WhatsApp (no bloqueamos por respuestas, se procesan en siguiente ciclo)
    if (CONFIG.RESPONSE_WAIT_MS > 0 && result.hasResponseExpected) {
      console.log(`[Scheduler] ⏳ Mensajes esperan respuesta. Manteniendo conexión ${CONFIG.RESPONSE_WAIT_MS / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RESPONSE_WAIT_MS));
      console.log(`[Scheduler] ⏳ Tiempo de espera completado, desconectando...`);
    }

    // MANTENER INSTANCIA ABIERTA (Mejora UX y velocidad)
    /*
    console.log(`[Scheduler] 🔌 Desconectando WhatsApp para ${resolvedBusinessId}...`);
    try {
      await whatsappService.stopInstance(resolvedBusinessId);
      console.log(`[Scheduler] ✅ WhatsApp desconectado para ${resolvedBusinessId}`);
    } catch (disconnectError) {
      console.warn(`[Scheduler] ⚠️ Error desconectando (no crítico):`, disconnectError.message);
    }
    */

    return {
      success: true,
      sent: result.sentCount,
      failed: result.failedCount,
      total: messages.length,
    };

  } catch (error) {
    console.error(`[Scheduler] ❌ Error general procesando negocio ${businessId}:`, error.message);
    /*
    try {
      await whatsappService.stopInstance(businessId);
    } catch (e) {}
    */
    throw error;
  }
}

/**
 * Envía un lote de mensajes con delays
 */
async function sendMessagesBatch(businessId, client, messages) {
  let sentCount = 0;
  let failedCount = 0;

  const hasResponseExpected = messages.some(msg => RESPONSE_TYPES.includes(msg.type));

  // Delay adaptativo: más rápido si hay muchos mensajes, más lento si son pocos
  const useHumanDelay = messages.length <= 3;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    try {
      if (i > 0) {
        // Pausa human-like cada HUMAN_PAUSE_INTERVAL mensajes para romper patrones
        if (i > 0 && i % CONFIG.HUMAN_PAUSE_INTERVAL === 0) {
          const humanPause = getHumanLikeDelay(CONFIG.HUMAN_PAUSE_MIN_MS, CONFIG.HUMAN_PAUSE_MAX_MS);
          console.log(`[Scheduler] 🧘 Pausa human-like (${Math.round(humanPause / 1000)}s) después de ${CONFIG.HUMAN_PAUSE_INTERVAL} mensajes para romper patrones...`);
          await new Promise(resolve => setTimeout(resolve, humanPause));
        }

        // Verificar límite de velocidad (anti-bloqueo)
        const rateLimitDelay = checkRateLimit(businessId);

        // Delay base adaptativo con distribución sesgada (no uniforme)
        const baseDelay = useHumanDelay
          ? getHumanLikeDelay(CONFIG.DELAY_BETWEEN_MESSAGES_HUMAN_MIN, CONFIG.DELAY_BETWEEN_MESSAGES_HUMAN_MAX)
          : getHumanLikeDelay(CONFIG.DELAY_BETWEEN_MESSAGES_MIN, CONFIG.DELAY_BETWEEN_MESSAGES_MAX);

        // Usar el mayor de los dos delays
        const totalDelay = Math.max(baseDelay, rateLimitDelay);
        console.log(`[Scheduler] ⏱️ Esperando ${Math.round(totalDelay / 1000)}s antes del siguiente mensaje...`);
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      } else {
        // Primer mensaje: verificar rate limit antes de enviar
        checkRateLimit(businessId);
      }

      await whatsappService.sendMessageDirect(businessId, msg.phone, msg.message);

      await msg.update({
        status: 'sent',
        sentAt: new Date(),
      });

      sentCount++;
      console.log(`[Scheduler] ✅ Mensaje enviado: ${msg.id}`);

    } catch (sendError) {
      const errorDetail = sendError.response?.data
        ? JSON.stringify(sendError.response.data, null, 2)
        : sendError.message;
      console.error(`[Scheduler] ❌ Error enviando mensaje ${msg.id}:`, errorDetail);

      const newRetryCount = msg.retryCount + 1;
      await msg.update({
        retryCount: newRetryCount,
        errorMessage: sendError.message,
        status: newRetryCount >= CONFIG.MAX_RETRIES ? 'failed' : 'pending',
      });

      failedCount++;
    }
  }

  return { sentCount, failedCount, hasResponseExpected };
}

module.exports = {
  processBusinessMessages,
};
