/**
 * Gestión inteligente de proxies para Evolution API
 * Archivo: evolution/proxyManager.js
 */

const fs = require('fs');
const path = require('path');
const sequelize = require('../../config/database');

const PROXIES_FILE = path.join(__dirname, '../../config/proxies.json');

/**
 * Carga la lista de proxies desde el archivo de configuración
 */
function loadProxies() {
  try {
    if (!fs.existsSync(PROXIES_FILE)) {
      console.warn(`[Proxy Manager] ⚠️ Archivo de proxies no encontrado: ${PROXIES_FILE}`);
      return [];
    }
    const data = fs.readFileSync(PROXIES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`[Proxy Manager] ❌ Error cargando proxies:`, err.message);
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
        const savedProxy = JSON.parse(existingSession.proxyConfig);
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
