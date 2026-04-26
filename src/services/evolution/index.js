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
    // PASO 1: Obtener instancias desde Evolution API
    const evolutionInstances = await instanceManager.fetchAllInstances();
    const validInstances = evolutionInstances.filter(inst => inst.name);
    console.log(`[Evolution API] 📊 ${validInstances.length} instancias válidas en Evolution API`);
    
    // PASO 2: Cargar instancias conectadas en memoria
    for (const instance of validInstances) {
      const status = instance.connectionStatus || instance.state || 'unknown';
      state.setInstance(instance.name, {
        instanceName: instance.name,
        status: status,
        createdAt: instance.createdAt
      });
      console.log(`[Evolution API] ✅ Instancia cargada: ${instance.name} (estado: ${status})`);
    }
    
    // PASO 3: Sincronizar sesiones conectadas desde BD que no estén en Evolution API
    // (para cuando Evolution pierde las instancias pero tenemos sesiones guardadas)
    try {
      const { WhatsAppSession } = require('../../models');
      const dbSessions = await WhatsAppSession.findAll({
        where: { status: 'connected' }
      });
      
      for (const session of dbSessions) {
        const existsInMemory = state.hasInstance(session.businessId);
        if (!existsInMemory) {
          // Verificar si realmente está conectada en Evolution API
          const realState = await instanceManager.getConnectionState(session.businessId);
          if (realState === 'open' || realState === 'connected') {
            state.setInstance(session.businessId, {
              instanceName: session.businessId,
              status: 'connected',
              phoneNumber: session.phoneNumber,
              createdAt: session.connectedAt || new Date()
            });
            console.log(`[Evolution API] ✅ Sesión BD sincronizada: ${session.businessId}`);
          } else {
            // No está realmente conectada, actualizar BD
            await session.update({ status: 'disconnected' });
            console.log(`[Evolution API] ⚠️ Sesión BD marcada desconectada: ${session.businessId}`);
          }
        }
      }
    } catch (syncErr) {
      console.error('[Evolution API] ⚠️ Error sincronizando sesiones BD:', syncErr.message);
    }
    
    // PASO 4: Iniciar sistema de keep-alive
    if (state.getInstanceCount() > 0) {
      heartbeat.startHeartbeat();
    }
    
    // PASO 5: Recuperar mensajes pendientes
    try {
      const pendingMessages = await recoverPendingMessages();
      if (pendingMessages.length > 0) {
        console.log(`[Evolution API] 🔄 ${pendingMessages.length} mensajes pendientes en cola`);
      }
    } catch (err) {
      console.error('[Evolution API] ❌ Error recuperando mensajes:', err.message);
    }
    
    console.log(`[Evolution API] ✅ Gestor iniciado: ${state.getInstanceCount()} instancias activas`);
    return state.getInstanceCount();
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
