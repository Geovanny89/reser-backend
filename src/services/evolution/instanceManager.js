/**
 * Gestor de Instancias Evolution API (Fachada Modular)
 * Archivo: evolution/instanceManager.js
 */

const actions = require('./instance.actions');
const queries = require('./instance.queries');
const messaging = require('./instance.messaging');
const proxy = require('./proxy');
const utils = require('./instance.utils');

const state = require('./state');

module.exports = {
  // Estado (para compatibilidad)
  instances: state.instances,
  currentQRs: state.currentQRs,

  // Acciones
  createInstance: actions.createInstance,
  stopInstance: actions.stopInstance,
  getQR: actions.getQR,
  forceReconnect: actions.forceReconnect,
  configureWebhook: actions.configureWebhook,

  // Consultas
  fetchAllInstances: queries.fetchAllInstances,
  getConnectionState: queries.getConnectionState,
  getInstanceInfo: queries.getInstanceInfo,
  hasValidSession: queries.hasValidSession,

  // Mensajería
  sendMessageDirect: messaging.sendMessageDirect,

  // Proxy
  ensureProxyConfig: proxy.ensureProxyConfig,
  getBestProxy: proxy.getBestProxy,

  // Utils
  formatPhoneForEvolution: utils.formatPhoneForEvolution,
  extractPhoneFromInstance: utils.extractPhoneFromInstance,
  
  // Backwards compatibility
  forceDisconnectAllInstances: async (reason = 'manual') => {
    const { getActiveBusinessIds } = require('./state');
    for (const id of getActiveBusinessIds()) {
      await actions.stopInstance(id);
    }
  }
};
