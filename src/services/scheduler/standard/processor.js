/**
 * Procesador de mensajes por negocio para el scheduler estándar
 */

const { WhatsAppSession } = require('../../../models');
const whatsappService = require('../../evolutionService');
const CONFIG = require('./config');
const trackers = require('./trackers');
const utils = require('./utils');

/**
 * Procesa mensajes de un negocio específico
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

    for (const msg of messages) {
      const newRetryCount = msg.retryCount + 1;
      await msg.update({
        retryCount: newRetryCount,
        errorMessage: error.message,
        status: newRetryCount >= CONFIG.MAX_RETRIES ? 'failed' : 'pending'
      });
    }

    return { success: false, reason: error.message, messagesKept: messages.length };
  }
}

/**
 * Procesamiento interno de mensajes de un negocio
 */
async function processBusinessMessagesInternal(businessId, messages) {
  try {
    console.log(`[Scheduler] 🔍 Verificando instancia para ${businessId}...`);
    const hasValidSession = await whatsappService.hasValidSession(businessId);
    
    if (!hasValidSession) {
      console.log(`[Scheduler] ⚠️ Negocio ${businessId} no tiene sesión válida o instancia no existe en Evolution API, saltando...`);
      return { success: false, reason: 'no_session', messagesKept: messages.length };
    }

    const session = await WhatsAppSession.findOne({
      where: { businessId, status: 'connected' }
    });

    if (!session) {
      console.log(`[Scheduler] ⚠️ Negocio ${businessId} no tiene sesión activa en BD, actualizando...`);
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

    console.log(`[Scheduler] 🔌 Conectando WhatsApp para ${businessId}...`);
    try {
      await whatsappService.createInstance(businessId);
      console.log(`[Scheduler] ✅ WhatsApp conectado para ${businessId}`);
      console.log(`[Scheduler] ⏳ Esperando sincronización de WhatsApp...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.SYNC_WAIT_MS));
      console.log(`[Scheduler] ✅ Sincronización completa`);
    } catch (connError) {
      console.error(`[Scheduler] ❌ Error conectando WhatsApp para ${businessId}:`, connError.message);
      for (const msg of messages) {
        await msg.update({ 
          retryCount: msg.retryCount + 1,
          errorMessage: connError.message
        });
      }
      return { success: false, reason: 'connection_failed' };
    }

    let sentCount = 0;
    let failedCount = 0;
    const useHumanDelay = messages.length <= 3;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      try {
        if (i > 0) {
          if (i > 0 && i % CONFIG.HUMAN_PAUSE_INTERVAL === 0) {
            const humanPause = utils.getHumanLikeDelay(CONFIG.HUMAN_PAUSE_MIN_MS, CONFIG.HUMAN_PAUSE_MAX_MS);
            console.log(`[Scheduler] 🧘 Pausa human-like (${Math.round(humanPause / 1000)}s) después de ${CONFIG.HUMAN_PAUSE_INTERVAL} mensajes...`);
            await new Promise(resolve => setTimeout(resolve, humanPause));
          }

          const rateLimitDelay = trackers.checkRateLimit(businessId);
          const baseDelay = useHumanDelay
            ? utils.getHumanLikeDelay(CONFIG.DELAY_BETWEEN_MESSAGES_HUMAN_MIN, CONFIG.DELAY_BETWEEN_MESSAGES_HUMAN_MAX)
            : utils.getHumanLikeDelay(CONFIG.DELAY_BETWEEN_MESSAGES_MIN, CONFIG.DELAY_BETWEEN_MESSAGES_MAX);

          const totalDelay = Math.max(baseDelay, rateLimitDelay);
          console.log(`[Scheduler] ⏱️ Esperando ${Math.round(totalDelay/1000)}s antes del siguiente mensaje...`);
          await new Promise(resolve => setTimeout(resolve, totalDelay));
        } else {
          trackers.checkRateLimit(businessId);
        }

        console.log(`[Scheduler] 📤 Enviando mensaje ${msg.id} via Evolution API...`);
        await whatsappService.sendMessageDirect(businessId, msg.phone, msg.message);

        await msg.update({
          status: 'sent',
          sentAt: new Date(),
          errorMessage: null
        });

        sentCount++;
        console.log(`[Scheduler] ✅ Mensaje enviado: ${msg.id} a ${msg.phone}`);

      } catch (sendError) {
        console.error(`[Scheduler] ❌ Error enviando mensaje ${msg.id}:`, sendError.message);
        const newRetryCount = msg.retryCount + 1;
        await msg.update({
          retryCount: newRetryCount,
          errorMessage: sendError.message,
          status: newRetryCount >= CONFIG.MAX_RETRIES ? 'failed' : 'pending'
        });
        failedCount++;
      }
    }

    const hasAwaitingResponse = messages.some(m => 
      ['rating', 'review', 'confirmation', 'custom'].includes(m.type)
    );
    
    if (hasAwaitingResponse) {
      console.log(`[Scheduler] ℹ️ Hay mensajes que esperan respuesta, manteniendo conexión`);
    }

    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
      total: messages.length
    };

  } catch (error) {
    console.error(`[Scheduler] ❌ Error general procesando negocio ${businessId}:`, error.message);
    throw error;
  }
}

module.exports = {
  processBusinessMessages
};
