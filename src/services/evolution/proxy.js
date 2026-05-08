/**
 * Gestión de Proxies para Evolution
 * Archivo: evolution/proxy.js
 */
const api = require('./api');

async function getBestProxy() {
  const host = process.env.PROXY_HOST || '201.219.206.231';
  const port = process.env.PROXY_PORT || '12323';
  return { host, port };
}

async function ensureProxyConfig(businessId) {
  try {
    const proxy = await getBestProxy();
    const proxyVerify = await api.get(`/proxy/find/${businessId}`).catch(() => ({ data: null }));
    
    if (!proxyVerify.data?.enabled || proxyVerify.data.host !== proxy.host) {
      console.log(`[Evolution API] 🛡️ Aplicando proxy para ${businessId}: ${proxy.host}`);
      await api.post(`/proxy/set/${businessId}`, {
        enabled: true,
        host: proxy.host,
        port: Number(proxy.port)
      });
    }
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getBestProxy,
  ensureProxyConfig
};
