/**
 * Gestión de Proxies para Evolution
 * Archivo: evolution/proxy.js
 */
const api = require('./api');

async function getBestProxy() {
  return {
    host: process.env.PROXY_HOST || '201.219.206.231',
    port: process.env.PROXY_PORT || '12323',
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD
  };
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
        port: String(proxy.port),
        password: proxy.password,
        username: proxy.username,
        protocol: 'http'
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
