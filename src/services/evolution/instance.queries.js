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
    const { getBaseBusinessId } = require('./instance.utils');

    const foundBusinessIds = new Set();

    for (const inst of instances) {
      const fullName = inst.name || inst.instanceName;
      if (!fullName) continue;

      const businessId = getBaseBusinessId(fullName);
      foundBusinessIds.add(businessId);

      const phone = extractPhoneFromInstance(inst);
      const status = inst.connectionStatus || inst.state || 'unknown';

      const existing = state.getInstance(businessId);
      const isNewActive = status === 'open' || status === 'connected';
      const isExistingActive = existing && (existing.status === 'open' || existing.status === 'connected');

      let shouldSet = false;
      if (!existing) {
        shouldSet = true;
      } else if (isNewActive && !isExistingActive) {
        shouldSet = true;
      } else if (!isNewActive && isExistingActive) {
        // No sobrescribir una sesión activa con una inactiva
        shouldSet = false;
      } else {
        // Si ambas están activas o ambas inactivas, preferimos la más reciente
        const existingTime = new Date(existing.createdAt).getTime();
        const newTime = new Date(inst.createdAt || new Date()).getTime();
        if (newTime > existingTime) {
          shouldSet = true;
        }
      }

      if (shouldSet) {
        state.setInstance(businessId, {
          instanceName: fullName,
          status: status,
          createdAt: inst.createdAt || new Date()
        });

        if (phone) {
          try {
            await WhatsAppSession.update(
              { phoneNumber: phone },
              { where: { businessId: businessId } }
            ).catch(() => { });
          } catch (e) { }
        }
      }
    }

    // Poda: Eliminar de memoria lo que ya no existe en la API
    const currentInMemory = state.getActiveBusinessIds();
    for (const id of currentInMemory) {
      if (!foundBusinessIds.has(id)) {
        console.log(`[Evolution API] 🧹 Podando instancia huérfana de memoria: ${id}`);
        state.deleteInstance(id);
        state.deleteQR(id);
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
    console.log(`[Evolution API] 🔍 Validando sesión para ${businessId}. Total instancias en API: ${allInstances.length}`);

    // 1. Priorizar la instancia que tenemos registrada en memoria
    const current = state.getInstance(businessId);
    if (current?.instanceName) {
      const activeInst = allInstances.find(i => (i.name || i.instanceName) === current.instanceName);
      if (activeInst) {
        const s = activeInst.connectionStatus || activeInst.status || activeInst.state;
        if (s === 'open' || s === 'connected') {
          console.log(`[Evolution API] ✅ Instancia actual ${current.instanceName} está conectada.`);
          return true;
        }
      }
    }

    // 2. Si no hay una "actual" conectada, buscar por nombre (incluyendo sufijos)
    // Pero solo si no estamos en medio de una creación (si hay un lock, no deberíamos confiar en sesiones viejas)
    const matching = allInstances.filter(inst => {
      const name = inst.name || inst.instanceName;
      return name === businessId || (name && name.startsWith(businessId + '_'));
    });

    for (const inst of matching) {
      const s = inst.connectionStatus || inst.status || inst.state;
      const name = inst.name || inst.instanceName;
      console.log(`[Evolution API] 💓 Instancia encontrada ${name} está en estado: ${s}`);
      if (s === 'open' || s === 'connected') {
        // Si encontramos una abierta que NO es la que tenemos en memoria, 
        // probablemente es una sesión antigua que sobrevivió. Sincronizar.
        if (current?.instanceName !== name) {
          console.log(`[Evolution API] 🔄 Sincronizando instancia activa encontrada: ${name}`);
          state.setInstance(businessId, {
            instanceName: name,
            status: s,
            phone: extractPhoneFromInstance(inst)
          });
        }
        return true;
      }
    }

    // 2. Buscar por teléfono si lo anterior falla
    console.log(`[Evolution API] ⚠️ No se encontró sesión por ID para ${businessId}, intentando por teléfono...`);
    const { Business } = require('../../models');
    const biz = await Business.findByPk(businessId);
    if (biz && biz.phone) {
      const cleanPhone = biz.phone.replace(/\D/g, '');
      const existsByPhone = allInstances.find(inst => {
        const iph = extractPhoneFromInstance(inst);
        return iph === cleanPhone || iph === '57' + cleanPhone;
      });

      if (existsByPhone) {
        const realState = await getConnectionState(existsByPhone.name || existsByPhone.instanceName);
        return realState === 'open' || realState === 'connected';
      }
    }

    return false;
  } catch (e) {
    console.error(`[Evolution API] ❌ Error en hasValidSession para ${businessId}:`, e.message);
    return false;
  }
}

module.exports = {
  fetchAllInstances,
  getConnectionState,
  getInstanceInfo,
  hasValidSession
};
