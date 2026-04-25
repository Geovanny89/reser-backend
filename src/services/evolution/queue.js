/**
 * Cola de mensajes para Evolution API - Persistente en BD
 * Archivo: evolution/queue.js
 */

const { ScheduledMessage } = require('../../models');
const { Op } = require('sequelize');

const {
  isQueueProcessing,
  startQueueProcessing,
  stopQueueProcessing,
  isStartingQueue,
  setStartingQueue
} = require('./state');

const { sendMessageDirect } = require('./instanceManager');

/**
 * Añade un mensaje a la cola persistente (BD + memoria)
 */
async function addToQueue(businessId, to, text) {
  const scheduledMsg = await ScheduledMessage.create({
    businessId,
    phone: to,
    message: text,
    type: 'queue_fallback',
    scheduledAt: new Date(),
    status: 'pending'
  });
  
  console.log(`[Evolution API] 💾 Mensaje guardado en BD (ID: ${scheduledMsg.id.slice(0,8)})`);
  
  // Usar flag atómico para evitar inicio concurrente
  if (!isQueueProcessing() && !isStartingQueue()) {
    setStartingQueue(true);
    processQueue().finally(() => {
      setStartingQueue(false);
    });
  }
  
  return scheduledMsg.id;
}

/**
 * Recupera mensajes pendientes de la BD al iniciar
 */
async function recoverPendingMessages() {
  try {
    const pending = await ScheduledMessage.findAll({
      where: {
        status: 'pending',
        type: 'queue_fallback',
        scheduledAt: { [Op.lte]: new Date() }
      },
      order: [['scheduledAt', 'ASC']]
    });
    
    if (pending.length > 0) {
      console.log(`[Evolution API] 🔄 Recuperados ${pending.length} mensajes pendientes de BD`);
    }
    
    return pending;
  } catch (e) {
    console.error(`[Evolution API] ❌ Error recuperando mensajes:`, e.message);
    return [];
  }
}

/**
 * Procesa la cola de mensajes desde la BD
 */
async function processQueue() {
  startQueueProcessing();
  
  // Obtener siguiente mensaje pendiente de la BD
  const message = await ScheduledMessage.findOne({
    where: {
      status: 'pending',
      type: 'queue_fallback',
      scheduledAt: { [Op.lte]: new Date() }
    },
    order: [['scheduledAt', 'ASC']]
  });
  
  if (!message) {
    stopQueueProcessing();
    return;
  }

  // Verificar horario laboral
  if (!isBusinessHours()) {
    const delayToMorning = getDelayToNextBusinessHours();
    console.log(`[Evolution API] ⏰ Fuera de horario laboral. Reanudando a las 7am Colombia`);
    setTimeout(processQueue, delayToMorning);
    return;
  }

  const { businessId, phone: to, message: text, id: messageId } = message;

  // Verificar si la instancia está lista
  const { hasValidSession } = require('./instanceManager');
  const isReady = hasValidSession(businessId);

  if (isReady) {
    await sendQueuedMessage(businessId, to, text, messageId);
  } else {
    await handleClientNotReady(message);
  }

  // Calcular delay para siguiente mensaje
  const pendingCount = await ScheduledMessage.count({
    where: { status: 'pending', type: 'queue_fallback' }
  });
  const baseDelay = getRandomDelay();
  const additionalDelay = pendingCount > 5 ? Math.random() * 60000 : 0;
  const nextDelay = baseDelay + additionalDelay;

  console.log(`[Evolution API] ⏱️ Próximo mensaje en ${Math.round(nextDelay / 1000)}s (${pendingCount} pendientes)`);
  setTimeout(processQueue, nextDelay);
}

/**
 * Envía un mensaje de la cola y actualiza su estado en BD
 */
async function sendQueuedMessage(businessId, to, text, messageId) {
  try {
    // Marcar como 'sending' en BD
    await ScheduledMessage.update(
      { status: 'sending' },
      { where: { id: messageId } }
    );

    // Enviar mensaje usando Evolution API
    await sendMessageDirect(businessId, to, text);
    
    // Marcar como enviado
    await ScheduledMessage.update(
      { status: 'sent', sentAt: new Date() },
      { where: { id: messageId } }
    );
    
    console.log(`[Evolution API] 📨 Mensaje enviado a ${to} (ID: ${messageId.slice(0,8)})`);
  } catch (e) {
    const errorDetail = e.response?.data
      ? JSON.stringify(e.response.data, null, 2)
      : e.message;
    console.error(`[Evolution API] ❌ Error enviando a ${to}:`, errorDetail);
    
    // Manejo específico para errores de autenticación (401 Unauthorized)
    if (e.response?.status === 401 || e.message.includes('401') || e.message.includes('Unauthorized')) {
      console.error(`[Evolution API] 🔴 ERROR DE AUTENTICACIÓN para negocio ${businessId} - Sesión cerrada o expirada`);
      console.error(`[Evolution API] ⚠️ ACCIÓN REQUERIDA: El admin debe volver a escanear el QR para el negocio ${businessId}`);
      
      // Marcar como failed con mensaje específico
      await ScheduledMessage.update(
        { 
          status: 'failed', 
          errorMessage: 'ERROR DE AUTENTICACIÓN (401): Sesión cerrada o expirada. Vuelva a escanear el QR.',
          errorType: 'auth_error'
        },
        { where: { id: messageId } }
      );
      
      // Opcional: Enviar notificación al admin (si existe sistema de notificaciones)
      // Aquí podrías agregar código para enviar email/push al dueño del negocio
      return;
    }
    
    // Reintentar más tarde si es error crítico
    if (e.message.includes('timeout') || e.message.includes('ECONNREFUSED')) {
      const msg = await ScheduledMessage.findByPk(messageId);
      if (msg && msg.retryCount < 3) {
        await ScheduledMessage.update(
          { 
            status: 'pending',
            retryCount: msg.retryCount + 1,
            scheduledAt: new Date(Date.now() + 5 * 60 * 1000) // Reintentar en 5 min
          },
          { where: { id: messageId } }
        );
        console.log(`[Evolution API] 🔄 Reencolado para reintento ${msg.retryCount + 1}/3`);
      } else {
        await ScheduledMessage.update(
          { status: 'failed', errorMessage: e.message },
          { where: { id: messageId } }
        );
      }
    } else {
      await ScheduledMessage.update(
        { status: 'failed', errorMessage: e.message },
        { where: { id: messageId } }
      );
    }
  }
}

/**
 * Maneja caso cuando el cliente no está listo
 */
async function handleClientNotReady(message) {
  const { businessId, id: messageId } = message;
  console.log(`[Evolution API] ⏸️ Cliente ${businessId} no activo, reprogramando mensaje...`);

  try {
    await ScheduledMessage.update(
      { 
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutos
        retryCount: message.retryCount + 1
      },
      { where: { id: messageId } }
    );
    console.log(`[Evolution API] 📅 Mensaje ${messageId.slice(0,8)} reprogramado para +5min`);
  } catch (err) {
    console.error(`[Evolution API] ❌ Error reprogramando:`, err.message);
  }
}

// ==================== UTILIDADES ====================

function isBusinessHours() {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19; // 7am - 7pm Colombia
}

function getDelayToNextBusinessHours() {
  const now = new Date();
  const tomorrow7am = new Date(now);
  tomorrow7am.setHours(7, 0, 0, 0);
  if (tomorrow7am <= now) {
    tomorrow7am.setDate(tomorrow7am.getDate() + 1);
  }
  return tomorrow7am - now;
}

function getRandomDelay() {
  return 2000 + Math.random() * 3000; // 2-5 segundos
}

// ==================== EXPORTS ====================

module.exports = {
  addToQueue,
  processQueue,
  recoverPendingMessages
};
