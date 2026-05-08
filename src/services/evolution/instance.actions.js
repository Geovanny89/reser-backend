/**
 * Acciones de gestión (Crear, Borrar, Reconnect)
 * Archivo: evolution/instance.actions.js
 */
const api = require('./api');
const state = require('./state');
const constants = require('./constants');
const { fetchAllInstances, getConnectionState } = require('./instance.queries');
const { extractPhoneFromInstance } = require('./instance.utils');

async function stopInstance(businessId, shouldLogout = true) {
  try {
    console.log(`[Evolution API] 🛑 Deteniendo instancia ${businessId}...`);
    try {
      if (shouldLogout) await api.delete(`/instance/logout/${businessId}`).catch(() => {});
      await api.post(`/instance/disconnect/${businessId}`).catch(() => {});
    } catch (e) { }

    let deleted = false;
    for (let i = 1; i <= 3; i++) {
      try {
        await api.delete(`/instance/delete/${businessId}`);
        deleted = true;
        break;
      } catch (err) {
        if (err.response?.status === 404) { deleted = true; break; }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    state.deleteInstance(businessId);
    return deleted;
  } catch (err) {
    return false;
  }
}

async function createInstance(businessId, forceFresh = false) {
  try {
    const { Business } = require('../../models');
    const biz = await Business.findByPk(businessId);
    if (!biz) throw new Error('Negocio no encontrado');

    const all = await fetchAllInstances();
    let existing = all.find(inst => inst.name === businessId);

    // Mapeo por teléfono si no existe por ID
    if (!existing && biz.phone) {
      const cleanPhone = biz.phone.replace(/\D/g, '');
      existing = all.find(inst => {
        const iph = extractPhoneFromInstance(inst);
        return iph === cleanPhone || iph === '57' + cleanPhone;
      });
      if (existing) businessId = existing.name;
    }

    if (existing && !forceFresh) {
      const status = existing.connectionStatus || existing.state || 'unknown';
      if (status === 'open' || status === 'connected') return { instance: existing, status };
    }

    if (forceFresh) await stopInstance(businessId);

    const createPayload = {
      instanceName: businessId,
      token: constants.DEFAULT_TOKEN,
      qrcode: true
    };

    const response = await api.post('/instance/create', createPayload);
    await configureWebhook(businessId);
    
    return response.data;
  } catch (err) {
    throw err;
  }
}

async function configureWebhook(businessId) {
  try {
    const webhookUrl = `${process.env.BACKEND_URL}/api/notifications/evolution/webhook`;
    const payload = {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
      }
    };
    await api.post(`/webhook/instance/${businessId}`, payload);
    return true;
  } catch (err) {
    return false;
  }
}

async function getQR(businessId) {
  try {
    const response = await api.get(`/instance/connect/${businessId}`);
    return response.data?.base64 || response.data?.code || null;
  } catch (err) {
    return null;
  }
}

async function forceReconnect(businessId, shouldLogout = false) {
  await stopInstance(businessId, shouldLogout);
  return createInstance(businessId, true);
}

module.exports = {
  stopInstance,
  createInstance,
  getQR,
  forceReconnect,
  configureWebhook
};
