/**
 * Acciones de gestión (Crear, Borrar, Reconnect)
 * Archivo: evolution/instance.actions.js
 */
const api = require('./api');
const state = require('./state');
const creationLocks = new Set();
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

    // 3. Intentar borrar físicamente
    let deleted = false;
    const idsToTry = [...new Set([targetId, businessId])].filter(Boolean);
    
    for (const idToTry of idsToTry) {
      if (deleted) break;
      try {
        await api.delete(`/instance/delete/${idToTry}?force=true`, {
          data: { instanceName: idToTry },
          timeout: 4000
        });
        deleted = true;
      } catch (err) {
        if (err.response?.status === 404) deleted = true;
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
  if (creationLocks.has(businessId)) {
    console.log(`[Evolution API] ⏳ Creación en curso para ${businessId}, omitiendo duplicado...`);
    return { success: false, status: 'busy' };
  }

  try {
    creationLocks.add(businessId);
    
    // 1. Verificar si ya existe para no causar conflictos
    const instances = await fetchAllInstances().catch(() => []);
    const existing = instances.find(i => i.name === businessId || i.instanceName === businessId);

    // Si NO es forceFresh y está conectada, la usamos directamente
    if (existing && !forceFresh) {
      if (existing.connectionStatus === 'open' || existing.status === 'open') {
        state.setInstance(businessId, { 
          status: 'open', 
          phone: extractPhoneFromInstance(existing)
        });
        return { success: true, status: 'open', existing: true };
      }
    }

    // 2. Preparar nombre dinámico (SIEMPRE si es forceFresh para evitar 403)
    let instanceNameToUse = businessId;
    if (forceFresh) {
      instanceNameToUse = `${businessId}_${Math.floor(1000 + Math.random() * 9000)}`;
      console.log(`[Evolution API] 🚀 Forzando instancia nueva: ${instanceNameToUse}`);
      
      // Intentamos cerrar la vieja en segundo plano (sin esperar)
      if (existing) {
        console.log(`[Evolution API] 🔄 Solicitando logout de sesión previa en background...`);
        api.delete(`/instance/logout/${businessId}`).catch(() => {});
      }
    }

    const createPayload = {
      instanceName: instanceNameToUse,
      token: constants.DEFAULT_TOKEN,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true
    };

    const response = await api.post('/instance/create', createPayload);
    const data = response.data;
    const qrData = data.qrcode?.base64 || data.qrcode?.code || data.code;

    state.setInstance(businessId, { 
      status: 'connecting',
      instanceName: instanceNameToUse,
      token: data.hash?.token || constants.DEFAULT_TOKEN
    });
    
    if (qrData) {
      state.setQR(businessId, qrData);
      console.log(`[Evolution API] 📲 QR generado y guardado para ${businessId}`);
    }

    return {
      success: true,
      status: 'connecting',
      qrcode: qrData,
      instance: data.instance
    };

  } catch (err) {
    console.error(`[Evolution API] ❌ Error en createInstance para ${businessId}:`, err.response?.data || err.message);
    return { success: false, error: err.message };
  } finally {
    creationLocks.delete(businessId);
  }
}

async function configureProxy(businessId) {
  // DESACTIVADO TEMPORALMENTE: Los proxies están causando 'Pre-key upload timeout'
  console.log(`[Evolution API] ℹ️ Proxy omitido para ${businessId} (Modo Debug)`);
  return true;
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
