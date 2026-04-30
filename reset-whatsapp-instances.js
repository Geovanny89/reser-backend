const axios = require('axios');
require('dotenv').config();

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY;

const api = axios.create({
  baseURL: EVOLUTION_URL,
  headers: { 'apikey': API_KEY },
  timeout: 30000
});

async function resetInstances() {
  try {
    console.log('🔄 Obteniendo instancias...');
    const response = await api.get('/instance/fetchInstances');
    const instances = response.data || [];
    
    console.log(`📊 Se encontraron ${instances.length} instancias`);
    
    for (const inst of instances) {
      const name = inst.name || inst.instanceName;
      const state = inst.state || inst.connectionStatus || 'unknown';
      
      console.log(`\n📱 Instancia: ${name}, Estado: ${state}`);
      
      // Si está en connecting o desconectado, eliminarla
      if (state === 'connecting' || state === 'close' || state === 'disconnected') {
        try {
          console.log(`  🗑️  Eliminando instancia ${name}...`);
          await api.delete(`/instance/delete/${name}`);
          console.log(`  ✅ Instancia ${name} eliminada`);
        } catch (e) {
          console.log(`  ⚠️  Error eliminando ${name}:`, e.response?.status || e.message);
        }
      } else {
        console.log(`  ℹ️  Instancia ${name} en estado ${state}, no se elimina`);
      }
    }
    
    console.log('\n✅ Limpieza completada. Las instancias se recrearán automáticamente cuando se necesiten.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ No se puede conectar a Evolution API. Verifica que esté corriendo en:', EVOLUTION_URL);
    }
  }
}

resetInstances();
