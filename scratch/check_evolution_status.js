const axios = require('axios');
require('dotenv').config({ path: '.env' });

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY || '1234';

console.log('EVOLUTION_URL:', EVOLUTION_URL);
console.log('API_KEY:', API_KEY);

const api = axios.create({
  baseURL: EVOLUTION_URL,
  headers: { 'apikey': API_KEY },
  timeout: 10000
});

async function run() {
  try {
    const res = await api.get('/instance/fetchInstances');
    const instances = res.data || [];
    console.log(`Total instances in API: ${instances.length}`);
    
    for (const inst of instances) {
      const name = inst.instanceName || inst.name;
      const status = inst.connectionStatus || inst.state || 'unknown';
      console.log(`\n- Instance: ${name}`);
      console.log(`  Status: ${status}`);
      
      // Fetch proxy for this instance
      try {
        const proxyRes = await api.get(`/proxy/find/${name}`);
        console.log(`  Proxy config in Evolution:`, JSON.stringify(proxyRes.data));
      } catch (err) {
        console.log(`  Proxy config fetch failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('Error fetching instances:', err.message);
  }
}

run();
