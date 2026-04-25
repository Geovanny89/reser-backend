/**
 * Servicio de Evolution API - Punto de entrada
 * Archivo: evolution/index.js
 */

const constants = require('./constants');
const templates = require('./templates');
const state = require('./state');
const instanceManager = require('./instanceManager');
const queue = require('./queue');
const utils = require('./utils');
const heartbeat = require('./heartbeat');
const messageHandler = require('./messageHandler');

const { recoverPendingMessages } = require('./queue');

async function initWhatsAppManager() {
  console.log('[Evolution API] 🚀 Iniciando gestor de instancias...');
  
  try {
    const evolutionInstances = await instanceManager.fetchAllInstances();
    
    // Filtrar solo instancias válidas con name definido
    const validInstances = evolutionInstances.filter(inst => inst.name);
    
    console.log(`[Evolution API] 📊 ${validInstances.length} instancias válidas encontradas en Evolution API`);
    
    for (const instance of validInstances) {
      state.setInstance(instance.name, {
        instanceName: instance.name,
        status: instance.connectionStatus,
        createdAt: instance.createdAt
      });
      console.log(`[Evolution API] ✅ Instancia cargada: ${instance.name} (estado: ${instance.connectionStatus})`);
    }
    
    // Iniciar sistema de keep-alive para mantener sesiones activas
    if (validInstances.length > 0) {
      heartbeat.startHeartbeat();
    }
    
    try {
      const pendingMessages = await recoverPendingMessages();
      if (pendingMessages.length > 0) {
        console.log(`[Evolution API] 🔄 Iniciando procesamiento de cola con ${pendingMessages.length} mensajes pendientes`);
        queue.processQueue();
      }
    } catch (err) {
      console.error('[Evolution API] ❌ Error recuperando mensajes pendientes:', err.message);
    }
    
    return validInstances.length;
  } catch (err) {
    console.error('[Evolution API] ❌ Error inicializando gestor:', err.message);
    return 0;
  }
}

module.exports = {
  initWhatsAppManager,
  createInstance: instanceManager.createInstance,
  getQR: instanceManager.getQR,
  stopInstance: instanceManager.stopInstance,
  forceReconnect: instanceManager.forceReconnect,
  forceDisconnectAllInstances: instanceManager.forceDisconnectAllInstances,
  queueMessage: queue.addToQueue,
  processQueue: queue.processQueue,
  recoverPendingMessages,
  sendMessageDirect: instanceManager.sendMessageDirect,
  getInstance: state.getInstance,
  hasValidSession: instanceManager.hasValidSession,
  isBusinessHours: utils.isBusinessHours,
  getRandomDelay: utils.getRandomDelay,
  getRandomConfirmationTemplate: templates.getRandomConfirmationTemplate,
  getRandomReminderTemplate: templates.getRandomReminderTemplate,
  getRandomRatingTemplate: templates.getRandomRatingTemplate,
  getRandomRatingThanksTemplate: templates.getRandomRatingThanksTemplate,
  getRandomCancelTemplate: templates.getRandomCancelTemplate,
  instances: state.instances,
  currentQRs: state.currentQRs,
  // Heartbeat functions
  startHeartbeat: heartbeat.startHeartbeat,
  stopHeartbeat: heartbeat.stopHeartbeat,
  isHeartbeatActive: heartbeat.isHeartbeatActive,
  getInstanceInfo: instanceManager.getInstanceInfo,
  // Message handling
  handleClientResponse: messageHandler.handleClientResponse,
  processAppointmentResponse: messageHandler.processAppointmentResponse
};
