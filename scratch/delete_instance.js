const axios = require('axios');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY || '1234';

const api = axios.create({
  baseURL: EVOLUTION_URL,
  headers: { 'apikey': API_KEY },
  timeout: 30000
});

const instanceToDelete = process.argv[2];

if (!instanceToDelete) {
  console.log('Error: Debes proporcionar el nombre de la instancia a eliminar.');
  console.log('Ejemplo: node scratch/delete_instance.js 6ad3cd82-a520-4782-a96e-a79c231d312c_4671');
  process.exit(1);
}

async function run() {
  console.log(`Intentando cerrar sesión y eliminar la instancia: ${instanceToDelete}...`);
  
  // 1. Logout
  try {
    await api.delete(`/instance/logout/${instanceToDelete}`);
    console.log('✅ Sesión cerrada en WhatsApp (Logout)');
  } catch (err) {
    console.warn('⚠️ Error al cerrar sesión (quizás ya estaba cerrada):', err.response?.data || err.message);
  }

  // 2. Disconnect
  try {
    await api.post(`/instance/disconnect/${instanceToDelete}`);
    console.log('✅ Instancia desconectada');
  } catch (err) {
    // Silencioso
  }

  // 3. Delete
  try {
    await api.delete(`/instance/delete/${instanceToDelete}?force=true`, {
      data: { instanceName: instanceToDelete }
    });
    console.log('✅ Instancia eliminada físicamente de la Evolution API');
  } catch (err) {
    console.error('❌ Error al eliminar instancia físicamente:', err.response?.data || err.message);
  }

  console.log('\nCompletado. El backend recreará la instancia cuando intente mandar un mensaje y te mostrará el código QR.');
}

run();
