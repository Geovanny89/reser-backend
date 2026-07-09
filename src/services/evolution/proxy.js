/**
 * Gestión de Proxies para Evolution
 * Archivo: evolution/proxy.js
 */
const api = require('./api');
const proxyManager = require('./proxyManager');

async function getBestProxy(businessId) {
  return await proxyManager.getBestProxy(businessId);
}

async function ensureProxyConfig(businessId) {
  try {
    const proxy = await getBestProxy(businessId);
    
    if (!proxy) {
      console.log(`[Evolution API] 🛡️ Desactivando proxy para ${businessId} (se usará la IP del servidor)`);
      await api.post(`/proxy/set/${businessId}`, {
        enabled: false,
        host: '',
        port: '0',
        password: '',
        username: '',
        protocol: 'http'
      }).catch(() => {});
      return true;
    }

    const proxyVerify = await api.get(`/proxy/find/${businessId}`).catch(() => ({ data: null }));

    if (!proxyVerify.data?.enabled || proxyVerify.data.host !== proxy.host) {
      console.log(`[Evolution API] 🛡️ Aplicando proxy para ${businessId}: ${proxy.host}`);
      await api.post(`/proxy/set/${businessId}`, {
        enabled: true,
        host: proxy.host,
        port: String(proxy.port),
        password: proxy.password || '',
        username: proxy.username || '',
        protocol: proxy.protocol || 'http'
      });
    }
    return true;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error en ensureProxyConfig para ${businessId}:`, err.message);
    return false;
  }
}

module.exports = {
  getBestProxy,
  ensureProxyConfig
};
