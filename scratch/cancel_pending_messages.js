// scratch/cancel_pending_messages.js
// --------------------------------------------------
// Cancela los mensajes programados (ScheduledMessages)
// que estén en estado "pending" y cuya fecha de envío programada
// sea anterior a la fecha actual, previniendo el envío masivo de spam.
// --------------------------------------------------

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ScheduledMessage } = require('../src/models');
const { Op } = require('sequelize');

(async () => {
  try {
    console.log('🔄 Buscando mensajes pendientes antiguos...');
    
    const count = await ScheduledMessage.count({
      where: {
        status: 'pending',
        scheduledAt: {
          [Op.lt]: new Date() // Menor que la fecha actual
        }
      }
    });

    if (count === 0) {
      console.log('✅ No se encontraron mensajes pendientes antiguos para cancelar.');
      process.exit(0);
    }

    console.log(`⚠️ Se encontraron ${count} mensajes antiguos. Cancelándolos...`);

    const [affectedCount] = await ScheduledMessage.update(
      {
        status: 'cancelled',
        errorMessage: 'Cancelado automáticamente para evitar spam por acumulación'
      },
      {
        where: {
          status: 'pending',
          scheduledAt: {
            [Op.lt]: new Date()
          }
        }
      }
    );

    console.log(`✅ ¡Éxito! Se cancelaron ${affectedCount} mensajes antiguos correctamente.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error al cancelar los mensajes:', err.message);
    process.exit(1);
  }
})();
