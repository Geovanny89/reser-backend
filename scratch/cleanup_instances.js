// scratch/cleanup_instances.js
// --------------------------------------------------
// Limpieza masiva: elimina TODAS las instancias que NO estén en estado "open"
// y opcionalmente también las "open" si se pasa --all
//
// Uso:
//   node scratch/cleanup_instances.js            # elimina solo zombis (close/connecting)
//   node scratch/cleanup_instances.js --all      # elimina TODO (fuerza nuevo QR)
// --------------------------------------------------

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8080';
const API_KEY = process.env.EVOLUTION_API_KEY || '1234';

const deleteAll = process.argv.includes('--all');

const api = axios.create({
  baseURL: EVOLUTION_URL,
  headers: { 'apikey': API_KEY },
  timeout: 30000
});

async function deleteInstance(name) {
  // 1. Logout
  try {
    await api.delete(`/instance/logout/${name}`);
  } catch (_) { /* ya estaba desconectada */ }

  // 2. Delete
  try {
    await api.delete(`/instance/delete/${name}`);
    return true;
  } catch (err) {
    console.error(`   ❌ No se pudo eliminar ${name}: ${err.response?.data?.message || err.message}`);
    return false;
  }
}

(async () => {
  try {
    const resp = await api.get('/instance/fetchInstances');
    const instances = Array.isArray(resp.data) ? resp.data : (resp.data?.instances || []);

    console.log(`Total instancias encontradas: ${instances.length}\n`);

    const openInstances = [];
    const zombieInstances = [];

    for (const inst of instances) {
      const name = inst.name || inst.instanceName || 'unknown';
      const status = inst.connectionStatus || inst.state || 'unknown';
      if (status === 'open' || status === 'connected') {
        openInstances.push({ name, status });
      } else {
        zombieInstances.push({ name, status });
      }
    }

    console.log(`✅ Instancias activas (open): ${openInstances.length}`);
    openInstances.forEach(i => console.log(`   - ${i.name}`));
    console.log(`\n🧟 Instancias zombi (close/connecting): ${zombieInstances.length}\n`);

    // Eliminar zombis
    let deleted = 0;
    for (const inst of zombieInstances) {
      process.stdout.write(`   Eliminando ${inst.name} (${inst.status})...`);
      const ok = await deleteInstance(inst.name);
      if (ok) {
        deleted++;
        console.log(' ✅');
      }
    }

    // Si se pasó --all, también eliminar las activas
    if (deleteAll) {
      console.log('\n⚠️  --all: Eliminando también instancias activas (se pedirá nuevo QR)...\n');
      for (const inst of openInstances) {
        process.stdout.write(`   Eliminando ${inst.name} (${inst.status})...`);
        const ok = await deleteInstance(inst.name);
        if (ok) {
          deleted++;
          console.log(' ✅');
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`Eliminadas: ${deleted} instancias`);
    if (!deleteAll && openInstances.length > 0) {
      console.log(`Conservadas (open): ${openInstances.length}`);
      console.log(`\n💡 Si quieres eliminar TAMBIÉN las activas y forzar un nuevo QR, ejecuta:`);
      console.log(`   node scratch/cleanup_instances.js --all`);
    }
    if (deleteAll) {
      console.log(`\n📱 El backend creará nuevas instancias y mostrará el QR para escanear.`);
    }
    console.log(`========================================`);

  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
  }
})();
