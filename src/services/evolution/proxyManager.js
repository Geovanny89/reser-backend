const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sequelize = require('../../config/database');
const { getBaseBusinessId } = require('./instance.utils');
const api = require('./api');
const state = require('./state');

const PROXIES_FILE = path.join(__dirname, '../../config/proxies.json');

/**
 * Carga la lista de proxies desde el archivo de configuración o variables de entorno
 */
function loadProxies() {
  // 1. Intentar cargar desde una variable de entorno que contenga el JSON completo (Ideal para Producción/Docker)
  const envProxiesJson = process.env.EVO_PROXIES_JSON;
  if (envProxiesJson) {
    try {
      const parsed = JSON.parse(envProxiesJson);
      if (Array.isArray(parsed)) {
        console.log(`[Proxy Manager] ℹ️ ${parsed.length} proxies cargados desde EVO_PROXIES_JSON`);
        return parsed;
      }
    } catch (err) {
      console.error(`[Proxy Manager] ❌ Error parseando EVO_PROXIES_JSON:`, err.message);
    }
  }

  // 2. Retrocompatibilidad: Verificar si existen variables de entorno para un proxy único
  const envHost = process.env.PROXY_HOST;
  if (envHost) {
    const envPort = process.env.PROXY_PORT ? parseInt(process.env.PROXY_PORT) : undefined;
    const envProtocol = process.env.PROXY_PROTOCOL || 'http';
    const envUser = process.env.PROXY_USERNAME || undefined;
    const envPass = process.env.PROXY_PASSWORD || undefined;
    const envMax = process.env.PROXY_MAX_INSTANCES ? parseInt(process.env.PROXY_MAX_INSTANCES) : undefined;

    const proxyFromEnv = {
      proxyHost: envHost,
      proxyPort: envPort,
      proxyProtocol: envProtocol,
      proxyUsername: envUser,
      proxyPassword: envPass,
      maxInstances: envMax
    };
    console.log('[Proxy Manager] ℹ️ Proxy único cargado desde variables de entorno');
    return [proxyFromEnv];
  }

  // 3. Cargar desde el archivo de configuración (ignorado por Git)
  try {
    if (!fs.existsSync(PROXIES_FILE)) {
      console.warn(`[Proxy Manager] ⚠️ Archivo de proxies no encontrado: ${PROXIES_FILE}`);
      return [];
    }
    const data = fs.readFileSync(PROXIES_FILE, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    console.error(`[Proxy Manager] ❌ Error cargando proxies desde archivo:`, err.message);
    return [];
  }
}

/**
 * Formatea un objeto de proxy para que sea compatible con Evolution API
 */
function formatProxyForEvolution(proxy) {
  if (!proxy) return null;
  const host = proxy.proxyHost || proxy.host;
  const port = parseInt(proxy.proxyPort || proxy.port);

  if (!host || isNaN(port)) {
    console.warn('[Proxy Manager] ⚠️ Proxy inválido detectado:', proxy);
    return null;
  }

  return {
    host,
    port,
    protocol: (proxy.proxyProtocol || proxy.protocol || 'http').toLowerCase(),
    username: proxy.proxyUsername || proxy.username || '',
    password: proxy.proxyPassword || proxy.password || ''
  };
}

/**
 * Prueba la conexión de un proxy usando una petición rápida de Axios.
 */
async function testProxyConnection(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return false;

  const url = 'https://www.google.com';
  const start = Date.now();
  const config = {
    timeout: 4000,
    proxy: {
      host: proxy.host,
      port: parseInt(proxy.port),
      protocol: proxy.protocol || 'http'
    }
  };

  if (proxy.username && proxy.password) {
    config.proxy.auth = {
      username: proxy.username,
      password: proxy.password
    };
  }

  try {
    if (!proxy || !proxy.host || !proxy.port) { console.warn(`[Proxy Manager] ⚠️ Proxy incompleto o inexistente, se omite la prueba.`); return false; }
    await axios.get(url, config);
    console.log(`[Proxy Manager] ✅ Proxy ${proxy.host}:${proxy.port} activo (Test ok en ${Date.now() - start}ms)`);
    return true;
  } catch (err) {
    console.warn(`[Proxy Manager] ❌ Proxy ${proxy.host}:${proxy.port} no responde o falló: ${err.message}`);
    return false;
  }
}

/**
 * Busca el mejor proxy disponible para un negocio.
 * Si el negocio ya tenía un proxy asignado, intenta devolver el mismo.
 * Si no, busca el que tenga menos de 4 instancias.
 */
async function getBestProxy(businessId) {
  try {
    const baseId = getBaseBusinessId(businessId);
    const proxies = loadProxies();
    if (proxies.length === 0) {
      console.log(`[Proxy Manager] ℹ️ No hay proxies configurados, se usará la IP del VPS.`);
      return null;
    }

    // 1. Verificar si este negocio ya tiene un proxy asignado en la DB
    const [existingSession] = await sequelize.query(
      `SELECT "proxyConfig" FROM "WhatsAppSessions" WHERE "businessId" = :businessId`,
      { replacements: { businessId: baseId }, type: sequelize.QueryTypes.SELECT }
    );

    if (existingSession && existingSession.proxyConfig) {
      try {
        // En JSONB con raw queries, el driver ya nos da el objeto, no hace falta JSON.parse
        const savedProxy = typeof existingSession.proxyConfig === 'string'
          ? JSON.parse(existingSession.proxyConfig)
          : existingSession.proxyConfig;

        const host = savedProxy.host || savedProxy.proxyHost;

        // Verificar que el proxy aún exista en nuestra lista
        const stillExists = proxies.find(p => p.proxyHost === host);
        if (stillExists) {
          console.log(`[Proxy Manager] ♻️ Reusando proxy existente para ${baseId}: ${host}`);
          const formatted = formatProxyForEvolution(stillExists);
          const isAlive = await testProxyConnection(formatted);
          if (isAlive) {
            return formatted;
          }
          console.warn(`[Proxy Manager] ⚠️ El proxy guardado (${host}) falló la verificación de conexión.`);
        }
      } catch (e) {
        console.error(`[Proxy Manager] ⚠️ Error parseando proxyConfig guardado:`, e.message);
      }
    }

    // 2. Si no tiene, no existe o falló, contar usos actuales de cada proxy
    // Solo contamos sesiones que no estén explícitamente desconectadas
    const [activeConfigs] = await sequelize.query(
      `SELECT "proxyConfig" FROM "WhatsAppSessions" WHERE "proxyConfig" IS NOT NULL AND "status" NOT IN ('disconnected')`
    );

    const usageCount = {};
    activeConfigs.forEach(row => {
      try {
        const cfg = JSON.parse(row.proxyConfig);
        const host = cfg.host || cfg.proxyHost;
        if (host) {
          usageCount[host] = (usageCount[host] || 0) + 1;
        }
      } catch (e) { }
    });

    // 3. Encontrar el primer proxy disponible que esté funcionando
    for (const proxy of proxies) {
      const currentUsage = usageCount[proxy.proxyHost] || 0;
      const limit = proxy.maxInstances || 4;

      if (currentUsage < limit) {
        console.log(`[Proxy Manager] 🎯 Probando proxy disponible para ${baseId}: ${proxy.proxyHost} (Uso: ${currentUsage}/${limit})`);
        const formatted = formatProxyForEvolution(proxy);
        const isAlive = await testProxyConnection(formatted);
        if (isAlive) {
          // Guardar proxy seleccionado en la DB
          try {
            await sequelize.query(
              `UPDATE "WhatsAppSessions" SET "proxyConfig" = :proxyConfig WHERE "businessId" = :businessId`,
              {
                replacements: {
                  proxyConfig: JSON.stringify(formatted),
                  businessId: baseId
                }
              }
            );
            console.log(`[Proxy Manager] 💾 Proxy guardado en DB para ${baseId}: ${proxy.proxyHost}`);
          } catch (dbErr) {
            console.error(`[Proxy Manager] ⚠️ Error guardando proxyConfig en DB:`, dbErr.message);
          }

          // Aplicar el nuevo proxy inmediatamente en la instancia activa de Evolution API si existe
          try {
            const realInstanceName = state.getRealInstanceName(baseId);
            console.log(`[Proxy Manager] 🛡️ Aplicando nuevo proxy en Evolution API para la instancia activa '${realInstanceName}': ${formatted.host}`);
            await api.post(`/proxy/set/${realInstanceName}`, {
              enabled: true,
              host: formatted.host,
              port: String(formatted.port),
              password: formatted.password || '',
              username: formatted.username || '',
              protocol: formatted.protocol || 'http'
            });
            console.log(`[Proxy Manager] ✅ Nuevo proxy configurado exitosamente en Evolution API para '${realInstanceName}'`);
          } catch (apiErr) {
            console.error(`[Proxy Manager] ❌ Error aplicando nuevo proxy en Evolution API para '${baseId}':`, apiErr.message);
          }

          return formatted;
        } else {
          console.warn(`[Proxy Manager] ⚠️ Proxy ${proxy.proxyHost} está caído. Probando el siguiente...`);
        }
      }
    }

    console.warn(`[Proxy Manager] ⚠️ Todos los proxies están llenos o caídos (${proxies.length} proxies). Se usará la IP del VPS/Servidor.`);

    // Limpiar proxyConfig en DB para marcar que saldrá directo
    try {
      await sequelize.query(
        `UPDATE "WhatsAppSessions" SET "proxyConfig" = NULL WHERE "businessId" = :businessId`,
        { replacements: { businessId: baseId } }
      );
      console.log(`[Proxy Manager] 💾 Se limpió proxyConfig en DB para ${baseId} (usará IP del VPS/Servidor)`);
    } catch (dbErr) {
      console.error(`[Proxy Manager] ⚠️ Error limpiando proxyConfig en DB:`, dbErr.message);
    }

    // Desactivar el proxy en Evolution API para la instancia activa para forzar tráfico por IP del servidor
    try {
      const realInstanceName = state.getRealInstanceName(baseId);
      console.log(`[Proxy Manager] 🛡️ Solicitando desactivación de proxy en Evolution API para la instancia activa '${realInstanceName}'...`);
      await api.post(`/proxy/set/${realInstanceName}`, {
        enabled: false,
        host: '',
        port: '0',
        password: '',
        username: '',
        protocol: 'http'
      });
      console.log(`[Proxy Manager] ✅ Proxy desactivado exitosamente en Evolution API para '${realInstanceName}'`);
    } catch (apiErr) {
      console.error(`[Proxy Manager] ❌ Error desactivando proxy en Evolution API para '${baseId}':`, apiErr.message);
    }

    return null;
  } catch (err) {
    console.error(`[Proxy Manager] ❌ Error seleccionando proxy:`, err.message);
    return null;
  }
}

module.exports = {
  getBestProxy,
  loadProxies
};
