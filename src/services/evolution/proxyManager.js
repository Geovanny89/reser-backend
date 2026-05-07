/**
 * Gestión inteligente de proxies para Evolution API
 * Archivo: evolution/proxyManager.js
 */

const fs = require('fs');
const path = require('path');
const sequelize = require('../../config/database');

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
  return {
    host: proxy.proxyHost || proxy.host,
    port: parseInt(proxy.proxyPort || proxy.port),
    protocol: proxy.proxyProtocol || proxy.protocol || 'http',
    username: proxy.proxyUsername || proxy.username,
    password: proxy.proxyPassword || proxy.password
  };
}

/**
 * Busca el mejor proxy disponible para un negocio.
 * Si el negocio ya tenía un proxy asignado, intenta devolver el mismo.
 * Si no, busca el que tenga menos de 4 instancias.
 */
async function getBestProxy(businessId) {
  try {
    const proxies = loadProxies();
    if (proxies.length === 0) {
      console.log(`[Proxy Manager] ℹ️ No hay proxies configurados, se usará la IP del VPS.`);
      return null;
    }

    // 1. Verificar si este negocio ya tiene un proxy asignado en la DB
    const [existingSession] = await sequelize.query(
      `SELECT "proxyConfig" FROM "WhatsAppSessions" WHERE "businessId" = :businessId`,
      { replacements: { businessId }, type: sequelize.QueryTypes.SELECT }
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
          console.log(`[Proxy Manager] ♻️ Reusando proxy existente para ${businessId}: ${host}`);
          return formatProxyForEvolution(stillExists);
        }
      } catch (e) {
        console.error(`[Proxy Manager] ⚠️ Error parseando proxyConfig guardado:`, e.message);
      }
    }

    // 2. Si no tiene o no existe, contar usos actuales de cada proxy
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
      } catch (e) {}
    });

    // 3. Encontrar el primer proxy disponible
    for (const proxy of proxies) {
      const currentUsage = usageCount[proxy.proxyHost] || 0;
      const limit = proxy.maxInstances || 4;

      if (currentUsage < limit) {
        console.log(`[Proxy Manager] 🎯 Proxy seleccionado para ${businessId}: ${proxy.proxyHost} (Uso: ${currentUsage}/${limit})`);
        return formatProxyForEvolution(proxy);
      }
    }

    console.warn(`[Proxy Manager] ⚠️ Todos los proxies están llenos (${proxies.length} proxies). Se usará la IP del VPS.`);
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
