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
    const { getBaseBusinessId } = require('./instance.utils');
    businessId = getBaseBusinessId(businessId);

    console.log(`[Evolution API] 🛑 Solicitando detención de ${businessId}...`);

    // 1. Obtener todas las instancias que coincidan (exacto o con sufijo)
    const all = await fetchAllInstances().catch(() => []);
    const matching = all.filter(i => {
      const name = i.name || i.instanceName;
      return name === businessId || (name && name.startsWith(businessId + '_'));
    });

    if (matching.length === 0) {
      console.log(`[Evolution API] ℹ️ No se encontraron instancias para ${businessId}`);
    }

    for (const inst of matching) {
      const targetName = inst.name || inst.instanceName;
      const targetId = inst.id || targetName;

      console.log(`[Evolution API] ⏳ Procesando detención de: ${targetName} (${targetId})`);

      // 2. Intentar desconectar y CERRAR (silencioso)
      try {
        if (shouldLogout) {
          await api.delete(`/instance/logout/${targetId}`).catch(() => { });
        }
        await api.post(`/instance/disconnect/${targetId}`).catch(() => { });
      } catch (e) { }

      // 3. Intentar borrar físicamente
      try {
        await api.delete(`/instance/delete/${targetId}?force=true`, {
          data: { instanceName: targetName },
          timeout: 5000
        }).catch(() => { });
      } catch (err) { }
    }

    // ESPERA CRÍTICA: Darle tiempo a la API para liberar archivos si hubo varias
    if (matching.length > 0) {
      await new Promise(r => setTimeout(r, 2000));
    }

    state.deleteInstance(businessId);
    state.deleteQR(businessId);

    return true;
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

    // 1. Verificar si ya existe alguna (incluyendo sufijos) para no causar conflictos
    const instances = await fetchAllInstances().catch(() => []);
    const matching = instances.filter(i => {
      const name = i.name || i.instanceName;
      return name === businessId || (name && name.startsWith(businessId + '_'));
    });

    const existingOpen = matching.find(i => i.connectionStatus === 'open' || i.status === 'open' || i.state === 'open');

    // Si NO es forceFresh y hay una conectada, la usamos directamente
    if (existingOpen && !forceFresh) {
      const activeName = existingOpen.name || existingOpen.instanceName;
      console.log(`[Evolution API] ✅ Reutilizando instancia abierta: ${activeName}`);
      state.setInstance(businessId, {
        status: 'open',
        instanceName: activeName,
        phone: extractPhoneFromInstance(existingOpen)
      });
      return { success: true, status: 'open', existing: true, instanceName: activeName };
    }

    // 2. Preparar nombre dinámico (SIEMPRE si es forceFresh para evitar 403)
    let instanceNameToUse = businessId;
    if (forceFresh) {
      // Usar timestamp para asegurar que el nombre sea único y no choque con basura vieja
      instanceNameToUse = `${businessId}_${Date.now()}`;
      console.log(`[Evolution API] 🚀 Forzando instancia nueva única: ${instanceNameToUse}`);

      // Limpieza profunda de instancias previas (incluyendo sufijos)
      try {
        await stopInstance(businessId, true);
      } catch (err) {
        console.warn(`[Evolution API] ⚠️ Error en limpieza previa de ${businessId}:`, err.message);
      }

      // Breve espera para que la API procese las eliminaciones antes de crear la nueva
      await new Promise(r => setTimeout(r, 1000));
    }

    const proxy = require('./proxy');
    const proxyConfig = await proxy.getBestProxy(businessId);

    const createPayload = {
      instanceName: instanceNameToUse,
      token: constants.DEFAULT_TOKEN,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      proxy: (proxyConfig && proxyConfig.host) ? {
        enabled: true,
        host: proxyConfig.host,
        port: Number(proxyConfig.port),
        username: proxyConfig.username || '',
        password: proxyConfig.password || ''
      } : undefined
    };

    const response = await api.post('/instance/create', createPayload);
    const data = response.data;

    // Forzar configuración de proxy por si la creación lo ignoró
    if (proxyConfig && proxyConfig.host) {
      await configureProxy(instanceNameToUse).catch(() => { });
    } else {
      // Si no hay proxyConfig o falló la conexión del proxy, asegurar que se desactive en la API
      await configureProxy(instanceNameToUse).catch(() => { });
    }

    const qrData = data.qrcode?.base64 || data.qrcode?.code || data.code;

    state.setInstance(businessId, {
      status: 'connecting',
      instanceName: instanceNameToUse,
      token: data.hash?.token || constants.DEFAULT_TOKEN
    });

    if (qrData) {
      state.setQR(businessId, qrData);
      console.log(`[Evolution API] 📲 QR generado (Proxy: ${proxyConfig.host || 'Directo'}) para ${businessId}`);
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
  try {
    const proxy = require('./proxy');
    return await proxy.ensureProxyConfig(businessId);
  } catch (err) {
    return false;
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
  const { getBaseBusinessId } = require('./instance.utils');
  businessId = getBaseBusinessId(businessId);

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
