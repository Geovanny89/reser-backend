const { Appointment } = require('./src/models');

async function run() {
  try {
    console.log('Buscando última cita...');
    const lastAppt = await Appointment.findOne({
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'clientName', 'startTime', 'endTime', 'status']
    });

    if (lastAppt) {
      console.log('\n✅ Última cita encontrada:');
      console.log('Cliente:', lastAppt.clientName);
      console.log('Hora de inicio (BD/UTC):', lastAppt.startTime.toISOString());
      console.log('Hora de inicio (Colombia):', lastAppt.startTime.toLocaleString('es-CO', { timeZone: 'America/Bogota' }));
    } else {
      console.log('\n⚠️ No se encontraron citas');
    }
    process.exit(0);
  } catch (e) {
    console.error('\n❌ Error:', e);
    process.exit(1);
  }
}

run();