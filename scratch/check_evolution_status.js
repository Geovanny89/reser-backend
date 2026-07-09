// scratch/check_evolution_status.js
// --------------------------------------------------
// Script de diagnóstico: lista todas las instancias registradas
// en la Evolution API y muestra su ID, estado y configuración de proxy.
// --------------------------------------------------

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const EVOLUTION_URL = process.env.EVOLUTION_URL;
const API_KEY = process.env.API_KEY;

if (!EVOLUTION_URL || !API_KEY) {
  console.error('❌ EVOLUTION_URL o API_KEY no están definidas en .env');
  process.exit(1);
}

(async () => {
  try {
    const resp = await axios.get(`${EVOLUTION_URL}/instances`, {
      headers: { 'x-api-key': API_KEY },
    });
    const instances = resp.data; // se espera un arreglo de objetos
    console.log(`EVOLUTION_URL: ${EVOLUTION_URL}`);
    console.log(`API_KEY: ${API_KEY}`);
    console.log(`Total instances in API: ${instances.length}`);

    instances.forEach(inst => {
      console.log('\n- Instance:', inst.id);
      console.log('  Status:', inst.status);
      // La API puede devolver proxyConfig o null
      const proxyInfo = inst.proxyConfig ? JSON.stringify(inst.proxyConfig) : 'null';
      console.log('  Proxy config in Evolution:', proxyInfo);
    });
  } catch (err) {
    console.error('Error al consultar la Evolution API:', err.message);
    if (err.response) {
      console.error('Respuesta del servidor:', err.response.status, err.response.data);
    }
  }
})();
