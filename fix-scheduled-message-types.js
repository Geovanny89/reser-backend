/**
 * Script para corregir tipos de mensajes programados inválidos
 * Ejecuta: node fix-scheduled-message-types.js
 */
const sequelize = require('./src/config/database');

async function fixMessageTypes() {
  try {
    console.log('🔧 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    // Tipos válidos según el ENUM
    const validTypes = ['reminder', 'rating', 'review', 'confirmation', 'cancellation', 'custom', 'queue_fallback'];

    // Buscar mensajes con tipos inválidos
    const [invalidMessages] = await sequelize.query(`
      SELECT id, type, "businessId", "appointmentId", message, status, "scheduledAt"
      FROM "ScheduledMessages"
      WHERE type NOT IN ('reminder', 'rating', 'review', 'confirmation', 'cancellation', 'custom', 'queue_fallback')
      AND status IN ('pending', 'failed')
    `);

    console.log(`📊 Se encontraron ${invalidMessages.length} mensajes con tipos inválidos`);

    if (invalidMessages.length === 0) {
      console.log('✅ No hay mensajes inválidos que corregir');
      process.exit(0);
    }

    // Mostrar mensajes inválidos
    console.log('\n📋 Mensajes inválidos encontrados:');
    invalidMessages.forEach((msg, i) => {
      console.log(`  ${i + 1}. ID: ${msg.id} | Tipo: "${msg.type}" | Estado: ${msg.status} | Programado: ${msg.scheduledAt}`);
    });

    // Corregir tipos inválidos
    console.log('\n🔧 Corrigiendo tipos...');

    for (const msg of invalidMessages) {
      let newType = 'custom'; // Por defecto

      // Mapear tipos inválidos a válidos
      const typeMap = {
        'confirm': 'confirmation',
        'confirmation': 'confirmation',
        'reminder_24h': 'reminder',
        'reminder_12h': 'reminder',
        'reminder_2h': 'reminder',
        'reminder_1h': 'reminder',
        'reminder_30m': 'reminder',
        'reference': 'reminder',
        'thank_you': 'custom',
        'thank-you': 'custom'
      };

      if (typeMap[msg.type]) {
        newType = typeMap[msg.type];
      } else if (validTypes.includes(msg.type)) {
        newType = msg.type; // Ya es válido
      }

      await sequelize.query(`
        UPDATE "ScheduledMessages"
        SET type = :newType
        WHERE id = :id
      `, {
        replacements: { newType, id: msg.id }
      });

      console.log(`  ✅ ${msg.id}: "${msg.type}" → "${newType}"`);
    }

    console.log('\n✅ Corrección completada');

    // Verificar que no queden mensajes inválidos
    const [remaining] = await sequelize.query(`
      SELECT COUNT(*) as count
      FROM "ScheduledMessages"
      WHERE type NOT IN ('reminder', 'rating', 'review', 'confirmation', 'cancellation', 'custom', 'queue_fallback')
      AND status IN ('pending', 'failed')
    `);

    const remainingCount = parseInt(remaining[0].count);
    if (remainingCount === 0) {
      console.log('✅ Todos los mensajes ahora tienen tipos válidos');
    } else {
      console.log(`⚠️ Aún quedan ${remainingCount} mensajes con tipos inválidos`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

fixMessageTypes();
