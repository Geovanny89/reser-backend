// scratch/check_db_sessions.js
// --------------------------------------------------
// Muestra el estado actual de las sesiones de WhatsApp
// registradas en la base de datos principal (PostgreSQL).
// --------------------------------------------------

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { WhatsAppSession } = require('../src/models');

(async () => {
  try {
    const sessions = await WhatsAppSession.findAll();
    console.log(`Total de sesiones registradas en BD: ${sessions.length}`);
    sessions.forEach(s => {
      console.log(`\n- Negocio: ${s.businessId}`);
      console.log(`  Estado: ${s.status}`);
      console.log(`  Número: ${s.phoneNumber || 'ninguno'}`);
      console.log(`  Nombre Perfil: ${s.profileName || 'ninguno'}`);
      console.log(`  Última actividad: ${s.lastActivity}`);
    });
    process.exit(0);
  } catch (err) {
    console.error('❌ Error al consultar la BD:', err.message);
    process.exit(1);
  }
})();
