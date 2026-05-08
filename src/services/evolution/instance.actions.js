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
    console.log(`[Evolution API] 🛑 Solicitando detención de ${businessId}...`);
    
    // 1. Obtener ID interno si existe (algunas versiones lo requieren para borrar)
    const all = await fetchAllInstances().catch(() => []);
    const existing = all.find(i => i.name === businessId || i.instanceName === businessId || i.id === businessId);
    const targetId = existing?.id || businessId;

    // 2. Intentar desconectar y CERRAR (silencioso)
    try {
      console.log(`[Evolution API] ⏳ Desconectando y esperando liberación de archivos...`);
      if (shouldLogout) await api.delete(`/instance/logout/${targetId}`).catch(() => {});
      await api.post(`/instance/disconnect/${targetId}`).catch(() => {});
      
      // ESPERA CRÍTICA: Darle tiempo a la API para cerrar los archivos de WhatsApp
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) { }

    // 3. Intentar borrar físicamente con reintentos agresivos
    let deleted = false;
    const idsToTry = [...new Set([targetId, businessId, existing?.id])].filter(Boolean);
    
    for (const idToTry of idsToTry) {
      if (deleted) break;
      console.log(`[Evolution API] 🗑️ Intentando borrar instancia: ${idToTry}`);
      
      for (let i = 1; i <= 3; i++) {
        try {
          // Intentamos borrar enviando el nombre tanto en la URL como en el cuerpo (algunas versiones lo exigen así)
          const res = await api.delete(`/instance/delete/${idToTry}?force=true`, {
            data: { instanceName: idToTry } 
          });
          if (res.status === 200 || res.status === 201) {
            deleted = true;
            console.log(`[Evolution API] ✅ Instancia ${idToTry} eliminada.`);
            break;
          }
        } catch (err) {
          if (err.response?.status === 404) {
            deleted = true;
            break;
          }
          console.error(`[Evolution API] ❌ Intento ${i} falló para ${idToTry}:`, err.response?.data?.response?.message || err.message);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    state.deleteInstance(businessId);
    state.deleteQR(businessId);
    
    return deleted;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error fatal en stopInstance:`, err.message);
    state.deleteInstance(businessId);
    return false;
  }
}

async function createInstance(businessId, forceFresh = false) {
  try {
    const { Business } = require('../../models');
    const biz = await Business.findByPk(businessId);
    if (!biz) throw new Error('Business not found');

    // 1. Verificar si ya existe para no causar conflictos (y evitar el 403)
    const instances = await fetchAllInstances();
    console.log(`[Evolution API] 📊 fetchInstances devolvió ${instances.length} instancias`);
    const existing = instances.find(i => i.name === businessId || i.instanceName === businessId);

    // Si NO es forceFresh y existe una abierta, la usamos
    if (existing && !forceFresh) {
      console.log(`[Evolution API] ℹ️ Instancia ${businessId} ya existe. Estado: ${existing.connectionStatus || existing.status}`);
      if (existing.connectionStatus === 'open' || existing.status === 'open') {
        state.setInstance(businessId, { 
          status: 'open', 
          phone: extractPhoneFromInstance(existing)
        });
        return { success: true, status: 'open', existing: true };
      }
    }

    // Si es forceFresh, SIEMPRE intentamos borrar la vieja primero
    if (forceFresh) {
      console.log(`[Evolution API] 🔄 ForceFresh: Intentando limpiar instancia previa...`);
      await stopInstance(businessId).catch(() => {});
      // No retornamos aquí, seguimos para crear la nueva con nombre dinámico
    }

    // 2. Crear nueva instancia
    console.log(`[Evolution API] 🚀 Creando nueva instancia para ${businessId}...`);
    
    // Si forceFresh es true, intentamos usar un nombre ligeramente distinto si el original falla
    let instanceNameToUse = businessId;
    if (forceFresh) {
      instanceNameToUse = `${businessId}_${Date.now().toString().slice(-4)}`;
      console.log(`[Evolution API] 🔄 Usando nombre fresco: ${instanceNameToUse}`);
    }

    const createPayload = {
      instanceName: instanceNameToUse,
      token: constants.DEFAULT_TOKEN,
      qrcode: true
    };

    try {
      const response = await api.post('/instance/create', createPayload);
      const data = response.data;

      state.setInstance(businessId, { 
        status: 'connecting',
        instanceName: instanceNameToUse, // Guardamos el nombre real usado
        token: data.hash?.token || constants.DEFAULT_TOKEN
      });

      return {
        success: true,
        status: 'connecting',
        qrcode: data.qrcode,
        instance: data.instance
      };
    } catch (err) {
      if (err.response?.status === 403 || err.response?.status === 400) {
        // Si el nombre con sufijo también falla, intentamos recuperar lo que haya
        const all = await fetchAllInstances().catch(() => []);
        const existing = all.find(i => i.name === businessId || i.instanceName === businessId);
        if (existing) return { success: true, status: 'open', instance: existing };
      }
      throw err;
    }
  } catch (err) {
    console.error(`[Evolution API] ❌ Error crítico en createInstance para ${businessId}:`, err.response?.data || err.message);
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
