const axios = require('axios');
require('dotenv').config();

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY;

const api = axios.create({
  baseURL: EVOLUTION_URL,
  headers: { 'apikey': API_KEY },
  timeout: 10000
});

async function checkInstances() {
  try {
    console.log('🔄 Obteniendo instancias...');
    const response = await api.get('/instance/fetchInstances');
    const instances = response.data || [];
    
    console.log(`📊 Se encontraron ${instances.length} instancias\n`);
    
    for (const inst of instances) {
      const name = inst.name || inst.instanceName;
      const state = inst.state || inst.connectionStatus || 'unknown';
      
      console.log(`📱 Instancia: ${name}`);
      console.log(`   Estado: ${state}`);
      
      if (state === 'open' || state === 'connected') {
        console.log(`   ✅ Conectada - debería enviar mensajes`);
      } else if (state === 'connecting') {
        console.log(`   ⚠️  Conectando - necesita escanear QR`);
      } else {
        console.log(`   ❌ Desconectada`);
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ No se puede conectar a Evolution API. Verifica que esté corriendo en:', EVOLUTION_URL);
    }
  }
}

checkInstances();
