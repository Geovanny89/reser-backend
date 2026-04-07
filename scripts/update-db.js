const { sequelize } = require('../src/models');

async function updateDatabase() {
  console.log('🚀 Iniciando actualización de base de datos...');
  
  try {
    await sequelize.authenticate();
    console.log('✅ Conexión establecida con PostgreSQL.');

    const queryInterface = sequelize.getQueryInterface();
    const tables = await queryInterface.showAllTables();

    // 1. Agregar columna isTechnicalServices a Businesses
    try {
      await sequelize.query('ALTER TABLE "Businesses" ADD COLUMN IF NOT EXISTS "isTechnicalServices" BOOLEAN DEFAULT false;');
      console.log('✅ Columna "isTechnicalServices" verificada/agregada en Businesses.');
    } catch (e) {
      console.error('❌ Error al agregar isTechnicalServices:', e.message);
    }

    // 2. Agregar columnas de recordatorios a Appointments
    const appointmentColumns = [
      { name: 'reminder30mSent', type: 'BOOLEAN' },
      { name: 'pendingAlert30mSent', type: 'BOOLEAN' },
      { name: 'pendingAlert60mSent', type: 'BOOLEAN' }
    ];

    for (const col of appointmentColumns) {
      try {
        await sequelize.query(`ALTER TABLE "Appointments" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type} DEFAULT false;`);
        console.log(`✅ Columna "${col.name}" verificada/agregada en Appointments.`);
      } catch (e) {
        console.error(`❌ Error al agregar ${col.name}:`, e.message);
      }
    }

    // 3. Crear tabla ClientDevices si no existe
    try {
      await sequelize.sync({ alter: true });
      console.log('✅ Sincronización de modelos completada (Tablas nuevas creadas).');
    } catch (e) {
      console.error('❌ Error en sincronización general:', e.message);
    }

    console.log('\n🎉 Actualización finalizada exitosamente.');
    process.exit(0);
  } catch (error) {
    console.error('💥 Error crítico actualizando la base de datos:', error);
    process.exit(1);
  }
}

updateDatabase();
