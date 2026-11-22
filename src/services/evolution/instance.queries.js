/**
 * Consultas de estado y fetch de instancias
 * Archivo: evolution/instance.queries.js
 */
const api = require('./api');
const state = require('./state');
const { extractPhoneFromInstance, getBaseBusinessId } = require('./instance.utils');

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
      const existingName = existing?.instanceName || '';
      const existingTs = parseInt(existingName.split('_')[1] || 0);
      const newTs = parseInt(fullName.split('_')[1] || 0);

      // Si tenemos en memoria una instancia más reciente (ej: recién creada esperando QR),
      // evitar que una instancia vieja la sobrescriba
      if (existingTs > newTs) {
        continue;
      }

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
    const instance = instances.find(inst => {
      const name = inst.name || inst.instanceName;
      return name === businessId || (name && name.startsWith(businessId + '_'));
    });
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
          // Verificar en vivo con Baileys para no engañar al frontend si el socket está en 'connecting'
          const liveState = await getConnectionState(current.instanceName);
          if (liveState === 'open' || liveState === 'connected') {
            console.log(`[Evolution API] ✅ Instancia actual ${current.instanceName} está conectada (verificado en vivo).`);
            return true;
          } else {
            console.log(`[Evolution API] ⚠️ Instancia actual ${current.instanceName} reporta '${s}' en lista pero en vivo está: '${liveState}'`);
            return false;
          }
        }
      }
    }

    // 2. Si no hay una "actual" conectada, buscar por nombre (priorizando la más reciente por timestamp)
    const matching = allInstances.filter(inst => {
      const name = inst.name || inst.instanceName;
      return name === businessId || (name && name.startsWith(businessId + '_'));
    });

    matching.sort((a, b) => {
      const tsA = parseInt((a.name || a.instanceName || '').split('_')[1] || 0);
      const tsB = parseInt((b.name || b.instanceName || '').split('_')[1] || 0);
      return tsB - tsA;
    });

    for (const inst of matching) {
      const s = inst.connectionStatus || inst.status || inst.state;
      const name = inst.name || inst.instanceName;
      console.log(`[Evolution API] 💓 Instancia encontrada ${name} está en estado: ${s}`);
      if (s === 'open' || s === 'connected') {
        const liveState = await getConnectionState(name);
        if (liveState === 'open' || liveState === 'connected') {
          if (current?.instanceName !== name) {
            console.log(`[Evolution API] 🔄 Sincronizando instancia activa confirmada en vivo: ${name}`);
            state.setInstance(businessId, {
              instanceName: name,
              status: 'connected',
              phone: extractPhoneFromInstance(inst)
            });
          }
          return true;
        }
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

/**
 * Elimina instancias fantasma: por cada negocio se conserva SOLO la mejor instancia
 * (la conectada o, si no hay, la más reciente) y se eliminan las demás.
 */
async function reapDuplicateInstances(instances = null) {
  try {
    const all = instances || await fetchAllInstances().catch(() => []);

    const groups = new Map();
    for (const inst of all) {
      const fullName = inst.name || inst.instanceName;
      if (!fullName) continue;
      const base = getBaseBusinessId(fullName);
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base).push(inst);
    }

    const isOpen = (i) => i.connectionStatus === 'open' || i.status === 'open' || i.state === 'open';
    const tsFromName = (i) => parseInt((i.name || i.instanceName || '').split('_')[1] || 0);
    const createdTs = (i) => new Date(i.createdAt || 0).getTime();

    let removed = 0;
    for (const [base, list] of groups.entries()) {
      if (list.length <= 1) continue;
      // No tocar si hay un QR pendiente (el usuario podría estar escaneando)
      if (state.hasQR && state.hasQR(base)) continue;

      const sorted = [...list].sort((a, b) => {
        const aOpen = isOpen(a) ? 1 : 0;
        const bOpen = isOpen(b) ? 1 : 0;
        if (aOpen !== bOpen) return bOpen - aOpen;
        return (tsFromName(b) || createdTs(b)) - (tsFromName(a) || createdTs(a));
      });

      const keep = sorted[0].name || sorted[0].instanceName;
      for (const inst of sorted.slice(1)) {
        const name = inst.name || inst.instanceName;
        console.log(`[Evolution API] 🧹 Eliminando instancia fantasma ${name} (se conserva ${keep})`);
        await deleteInstanceByName(name);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[Evolution API] 🧹 ${removed} instancia(s) fantasma eliminada(s)`);
    }
    return removed;
  } catch (err) {
    console.error('[Evolution API] ❌ Error limpiando instancias fantasma:', err.message);
    return 0;
  }
}

/**
 * Elimina una instancia concreta por su nombre real
 */
async function deleteInstanceByName(name) {
  try {
    await api.delete(`/instance/logout/${name}`).catch(() => { });
    await api.post(`/instance/disconnect/${name}`).catch(() => { });
    await api.delete(`/instance/delete/${name}?force=true`, {
      data: { instanceName: name },
      timeout: 8000
    }).catch((e) => {
      console.warn(`[Evolution API] ⚠️ No se pudo eliminar ${name}: ${e.response?.status || e.message}`);
    });
  } catch (e) { }
}

module.exports = {
  fetchAllInstances,
  getConnectionState,
  getInstanceInfo,
  hasValidSession,
  reapDuplicateInstances
};
