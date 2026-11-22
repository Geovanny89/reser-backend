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

      // 2. Intentar desconectar y CERRAR — intentar por id Y por name
      try {
        if (shouldLogout) {
          await api.delete(`/instance/logout/${targetId}`).catch(() => { });
          if (targetName !== targetId) {
            await api.delete(`/instance/logout/${targetName}`).catch(() => { });
          }
        }
        await api.post(`/instance/disconnect/${targetId}`).catch(() => { });
        if (targetName !== targetId) {
          await api.post(`/instance/disconnect/${targetName}`).catch(() => { });
        }
      } catch (e) { }

      // 3. Intentar borrar físicamente — por id Y por name para asegurar eliminación
      try {
        await api.delete(`/instance/delete/${targetId}?force=true`, {
          data: { instanceName: targetName },
          timeout: 5000
        }).catch(() => { });
      } catch (err) { }

      try {
        if (targetName !== targetId) {
          await api.delete(`/instance/delete/${targetName}?force=true`, {
            data: { instanceName: targetName },
            timeout: 5000
          }).catch(() => { });
        }
      } catch (err) { }
    }

    // ESPERA CRÍTICA: Aumentada a 5s para asegurar que la API libere completamente todas las instancias
    if (matching.length > 0) {
      await new Promise(r => setTimeout(r, 5000));
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

    // Si NO es forceFresh y hay una conectada, verificamos si realmente está conectada en vivo
    if (existingOpen && !forceFresh) {
      const activeName = existingOpen.name || existingOpen.instanceName;
      const { getConnectionState } = require('./instance.queries');
      const liveState = await getConnectionState(activeName).catch(() => null);

      if (liveState === 'open' || liveState === 'connected') {
        console.log(`[Evolution API] ✅ Reutilizando instancia abierta y confirmada: ${activeName}`);
        state.setInstance(businessId, {
          status: 'open',
          instanceName: activeName,
          phone: extractPhoneFromInstance(existingOpen)
        });
        return { success: true, status: 'open', existing: true, instanceName: activeName };
      }
    }

    // 2. Nombre de instancia ESTABLE (businessId): así existe SIEMPRE una sola instancia por negocio.
    //    Antes se usaba `${businessId}_${timestamp}` en forceFresh, lo que generaba instancias
    //    fantasma acumuladas cuando la eliminación previa no se completaba a tiempo.
    const instanceNameToUse = businessId;

    if (forceFresh) {
      console.log(`[Evolution API] 🚀 Recreando instancia limpia estable: ${instanceNameToUse}`);

      // Limpieza profunda de instancias previas (con o sin sufijo)
      try {
        await stopInstance(businessId, true);
      } catch (err) {
        console.warn(`[Evolution API] ⚠️ Error en limpieza previa de ${businessId}:`, err.message);
      }

      // Verificar que realmente se eliminó antes de recrear (evita 403 por nombre ocupado)
      for (let attempt = 0; attempt < 5; attempt++) {
        const still = await fetchAllInstances().catch(() => []);
        const remains = still.some(i => {
          const n = i.name || i.instanceName;
          return n === businessId || (n && n.startsWith(businessId + '_'));
        });
        if (!remains) break;
        console.log(`[Evolution API] ⏳ Instancia ${businessId} aún presente, esperando liberación... (${attempt + 1}/5)`);
        await new Promise(r => setTimeout(r, 2000));
      }
    } else if (matching.length > 0) {
      // Ya existe una instancia para este negocio: NO crear duplicados (evita instancias fantasma).
      const best = matching.find(i => i.connectionStatus === 'open' || i.status === 'open' || i.state === 'open') || matching[0];
      const activeName = best.name || best.instanceName;
      console.log(`[Evolution API] ♻️ Reutilizando instancia existente ${activeName} (sin crear duplicado)`);

      // Reconexión suave solo si no hay un QR pendiente de escaneo
      if (!state.hasQR(businessId)) {
        await api.post(`/instance/restart/${activeName}`).catch(() => { });
        await api.get(`/instance/connect/${activeName}`).catch(() => { });
      }

      state.setInstance(businessId, {
        status: best.connectionStatus || best.status || best.state || 'connecting',
        instanceName: activeName,
        phone: extractPhoneFromInstance(best)
      });
      return { success: true, status: 'connecting', existing: true, instanceName: activeName };
    }

    // Limpiamos el QR anterior de la memoria explícitamente antes de crear
    state.deleteQR(businessId);

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
      await configureProxy(instanceNameToUse).catch(() => { });
    }

    let qrData = data.qrcode?.base64 || data.qrcode?.code || data.code;

    // RESPALDO: Si la instancia se creó pero no devolvió el QR en el body, lo pedimos explícitamente
    if (!qrData) {
      console.log(`[Evolution API] 🔄 Solicitando QR explícito para ${instanceNameToUse}...`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        const qrResponse = await api.get(`/instance/connect/${instanceNameToUse}`);
        qrData = qrResponse.data?.base64 || qrResponse.data?.code || null;
      } catch (e) {
        console.warn(`[Evolution API] ⚠️ No se pudo obtener el QR explícito:`, e.message);
      }
    }

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
    // Usar el nombre real de la instancia (con sufijo) desde el estado en memoria.
    // Si no lo tenemos (ej: backend reiniciado), reconstruirlo consultando la API.
    let instanceName = state.getInstance(businessId)?.instanceName;
    if (!instanceName) {
      await fetchAllInstances().catch(() => { });
      instanceName = state.getInstance(businessId)?.instanceName || businessId;
    }

    const backendUrl = process.env.BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
    const webhookUrl = `${backendUrl}/api/notifications/evolution/webhook`;

    console.log(`[Evolution API] 🔗 Configurando webhook para ${instanceName}: ${webhookUrl}`);

    const payload = {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        base64: true,
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"]
      }
    };
    // En Evolution API v2 el endpoint correcto es POST /webhook/set/{instance}
    await api.post(`/webhook/set/${instanceName}`, payload);
    console.log(`[Evolution API] ✅ Webhook configurado para ${instanceName}`);
    return true;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error configurando webhook: ${err.response?.data?.message || err.message}`);
    return false;
  }
}

async function getQR(businessId) {
  try {
    const { getBaseBusinessId } = require('./instance.utils');
    const baseId = getBaseBusinessId(businessId);
    const realName = state.getRealInstanceName(baseId);

    // Probar primero con el nombre real (con sufijo) y luego con el businessId base
    const candidates = realName && realName !== baseId ? [realName, baseId] : [baseId];

    for (const name of candidates) {
      try {
        const response = await api.get(`/instance/connect/${name}`);
        const qr = response.data?.base64 || response.data?.code || response.data?.qrcode?.base64 || null;
        if (qr) {
          if (name !== realName) {
            state.setInstance(baseId, { ...(state.getInstance(baseId) || {}), instanceName: name });
          }
          return qr;
        }
      } catch (e) {
        // Probar el siguiente candidato
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function forceReconnect(businessId, shouldLogout = false) {
  const { getBaseBusinessId } = require('./instance.utils');
  businessId = getBaseBusinessId(businessId);

  // RECONEXIÓN SUAVE (sin logout): reiniciar la instancia en su lugar para CONSERVAR la sesión
  // de WhatsApp. Antes se eliminaba y recreaba la instancia, lo que destruía la sesión y obligaba
  // a re-escanear el QR ante cualquier desconexión temporal (causa de las caídas cada 3-5 días).
  if (!shouldLogout) {
    const realName = state.getRealInstanceName(businessId);
    try {
      const all = await fetchAllInstances().catch(() => []);
      const exists = all.some(i => (i.name || i.instanceName) === realName);

      if (exists) {
        console.log(`[Evolution API] ♻️ Reconexión suave para ${realName} (conservando sesión)...`);
        // v2 usa POST /instance/restart/{instance}; versiones antiguas usan PUT
        const restartRes = await api.post(`/instance/restart/${realName}`).catch((e) => e);
        if (restartRes instanceof Error) {
          await api.put(`/instance/restart/${realName}`).catch((e) =>
            console.warn(`[Evolution API] ⚠️ restart falló (${e.message}), intentando connect...`)
          );
        }
        // Forzar la reconexión del socket sin eliminar la instancia
        await api.get(`/instance/connect/${realName}`).catch(() => { });
        await new Promise(r => setTimeout(r, 3000));

        const newState = await getConnectionState(businessId).catch(() => null);
        console.log(`[Evolution API] ℹ️ Estado tras reconexión suave de ${realName}: ${newState}`);
        return { success: true, status: newState || 'connecting', instanceName: realName, soft: true };
      }

      console.log(`[Evolution API] ℹ️ No existe instancia recuperable para ${businessId}, se creará una nueva.`);
    } catch (err) {
      console.warn(`[Evolution API] ⚠️ Falló la reconexión suave de ${businessId}: ${err.message}`);
    }
  }

  // Recreación limpia (requiere nuevo QR): solo en logout explícito o cuando no hay instancia recuperable
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
