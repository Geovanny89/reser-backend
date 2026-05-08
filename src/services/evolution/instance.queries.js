/**
 * Consultas de estado y fetch de instancias
 * Archivo: evolution/instance.queries.js
 */
const api = require('./api');
const state = require('./state');
const { extractPhoneFromInstance } = require('./instance.utils');

async function fetchAllInstances() {
  try {
    const response = await api.get('/instance/fetchInstances');
    const instances = response.data || [];
    
    // Sincronizar memoria y BD
    const { WhatsAppSession } = require('../../models');
    for (const inst of instances) {
      const name = inst.name || inst.instanceName;
      if (!name) continue;

      const phone = extractPhoneFromInstance(inst);
      const status = inst.connectionStatus || inst.state || 'unknown';

      state.setInstance(name, {
        instanceName: name,
        status: status,
        createdAt: inst.createdAt || new Date()
      });

      if (phone) {
        try {
          await WhatsAppSession.update(
            { phoneNumber: phone },
            { where: { businessId: name } }
          ).catch(() => {});
        } catch (e) {}
      }
    }
    return instances;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error obteniendo instancias:`, err.message);
    return [];
  }
}

async function getConnectionState(businessId) {
  try {
    const realName = state.getRealInstanceName(businessId);
    const response = await api.get(`/instance/connectionState/${realName}`);
    const status = response.data?.instance?.state || response.data?.state || null;
    
    if (status) {
      const current = state.getInstance(businessId) || {};
      state.setInstance(businessId, { ...current, status });
    }
    return status;
  } catch (err) {
    if (err.response?.status === 404) return null;
    return null;
  }
}

async function getInstanceInfo(businessId) {
  try {
    const instances = await fetchAllInstances();
    const instance = instances.find(inst => inst.name === businessId || inst.instanceName === businessId);
    if (!instance) return null;

    return {
      name: instance.name || instance.instanceName,
      status: instance.connectionStatus || instance.status || instance.state,
      phoneNumber: extractPhoneFromInstance(instance),
      profileName: instance.profileName || null,
      profilePicUrl: instance.profilePicUrl || null
    };
  } catch (err) {
    return null;
  }
}

async function hasValidSession(businessId) {
  try {
    const allInstances = await fetchAllInstances();
    // Búsqueda inteligente: que el nombre sea exacto o que empiece por el businessId (para sufijos dinámicos)
    let exists = allInstances.find(inst => 
      inst.name === businessId || 
      inst.instanceName === businessId ||
      (inst.name && inst.name.startsWith(businessId + '_'))
    );

    // Búsqueda inteligente por teléfono si falla por ID
    if (!exists) {
      const { Business } = require('../../models');
      const biz = await Business.findByPk(businessId);
      if (biz && biz.phone) {
        const cleanPhone = biz.phone.replace(/\D/g, '');
        exists = allInstances.find(inst => {
          const iph = extractPhoneFromInstance(inst);
          return iph === cleanPhone || iph === '57' + cleanPhone;
        });
      }
    }

    if (!exists) return false;
    const realState = await getConnectionState(exists.name);
    return realState === 'open' || realState === 'connected';
  } catch (e) {
    return false;
  }
}

module.exports = {
  fetchAllInstances,
  getConnectionState,
  getInstanceInfo,
  hasValidSession
};
