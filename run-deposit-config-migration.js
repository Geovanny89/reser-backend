/**
 * Script para agregar campo depositConfig a Business
 */
const sequelize = require('./src/config/database');

async function runMigration() {
  try {
    console.log('🔧 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    console.log('📦 Agregando campo depositConfig a Businesses...');
    
    await sequelize.query(`
      ALTER TABLE "Businesses" 
      ADD COLUMN IF NOT EXISTS "depositConfig" JSONB DEFAULT '{
        "required": false,
        "amount": 0,
        "percentage": 30,
        "cancelationHours": 24,
        "penaltyEnabled": true,
        "termsText": "El anticipo garantiza tu cita. Si cancelas con menos de 24 horas de anticipo o no asistes, el anticipo será retenido como penalidad."
      }' NOT NULL
    `);

    console.log('✅ Migración completada exitosamente');
    console.log('📝 Campo depositConfig agregado a Businesses');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error en la migración:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runMigration();
