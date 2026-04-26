/**
 * Procesamiento de mensajes por negocio
 */
const whatsappService = require('../evolutionService');
const { CONFIG, RESPONSE_TYPES } = require('./config');

/**
 * Procesa mensajes de un negocio específico (con timeout)
 */
async function processBusinessMessages(businessId, messages) {
  console.log(`[Scheduler] 📦 Procesando ${messages.length} mensajes para negocio ${businessId}`);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout: procesamiento de negocio excedió 6 minutos')), CONFIG.BUSINESS_TIMEOUT_MS)
  );

  try {
    return await Promise.race([processBusinessMessagesInternal(businessId, messages), timeoutPromise]);
  } catch (error) {
    console.error(`[Scheduler] ❌ Timeout o error procesando negocio ${businessId}:`, error.message);

    try {
      await whatsappService.stopInstance(businessId);
    } catch (e) {}

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

      const { processIncomingMessages } = require('./incoming.processor');
      await processIncomingMessages(resolvedBusinessId, client);

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

    // Desconectar WhatsApp
    if (result.hasResponseExpected) {
      console.log(`[Scheduler] ⏳ Mensajes esperan respuesta. Manteniendo conexión 5 minutos...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RESPONSE_WAIT_MS));
      console.log(`[Scheduler] ⏳ Tiempo de espera completado, desconectando...`);
    }

    console.log(`[Scheduler] 🔌 Desconectando WhatsApp para ${resolvedBusinessId}...`);
    try {
      await whatsappService.stopInstance(resolvedBusinessId);
      console.log(`[Scheduler] ✅ WhatsApp desconectado para ${resolvedBusinessId}`);
    } catch (disconnectError) {
      console.warn(`[Scheduler] ⚠️ Error desconectando (no crítico):`, disconnectError.message);
    }

    return {
      success: true,
      sent: result.sentCount,
      failed: result.failedCount,
      total: messages.length,
    };

  } catch (error) {
    console.error(`[Scheduler] ❌ Error general procesando negocio ${businessId}:`, error.message);
    try {
      await whatsappService.stopInstance(businessId);
    } catch (e) {}
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

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    try {
      if (i > 0) {
        const delay = CONFIG.DELAY_BETWEEN_MESSAGES_MIN + Math.random() * (CONFIG.DELAY_BETWEEN_MESSAGES_MAX - CONFIG.DELAY_BETWEEN_MESSAGES_MIN);
        console.log(`[Scheduler] ⏱️ Esperando ${Math.round(delay / 1000)}s antes del siguiente mensaje...`);
        await new Promise(resolve => setTimeout(resolve, delay));
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
