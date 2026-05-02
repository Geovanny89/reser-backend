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
      { name: 'reminder2hSent', type: 'BOOLEAN' },
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

    // 2.5 Agregar columna extraServices a Appointments
    try {
      await sequelize.query('ALTER TABLE "Appointments" ADD COLUMN IF NOT EXISTS "extraServices" JSON DEFAULT \'[]\';');
      console.log('✅ Columna "extraServices" verificada/agregada en Appointments.');
    } catch (e) {
      console.error('❌ Error al agregar extraServices:', e.message);
    }

    // 3. Agregar columnas de trazabilidad para caja (cash_movements)
    try {
      await sequelize.query('ALTER TABLE "cash_movements" ADD COLUMN IF NOT EXISTS "isReversal" BOOLEAN NOT NULL DEFAULT false;');
      console.log('✅ Columna "isReversal" verificada/agregada en cash_movements.');
    } catch (e) {
      console.error('❌ Error al agregar isReversal en cash_movements:', e.message);
    }

    try {
      await sequelize.query('ALTER TABLE "cash_movements" ADD COLUMN IF NOT EXISTS "reversesMovementId" UUID NULL;');
      console.log('✅ Columna "reversesMovementId" verificada/agregada en cash_movements.');
    } catch (e) {
      console.error('❌ Error al agregar reversesMovementId en cash_movements:', e.message);
    }

    // Índices (opcionales pero recomendados)
    try {
      await sequelize.query('CREATE INDEX IF NOT EXISTS "idx_cash_movements_isReversal" ON "cash_movements" ("isReversal");');
      await sequelize.query('CREATE INDEX IF NOT EXISTS "idx_cash_movements_reversesMovementId" ON "cash_movements" ("reversesMovementId");');
      console.log('✅ Índices de caja verificados/creados en cash_movements.');
    } catch (e) {
      console.error('❌ Error creando índices de caja:', e.message);
    }

    // 4. Agregar columnas para anulación de gastos (Expenses)
    try {
      await sequelize.query('ALTER TABLE "Expenses" ADD COLUMN IF NOT EXISTS "status" VARCHAR(10) NOT NULL DEFAULT \'active\';');
      await sequelize.query('ALTER TABLE "Expenses" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP NULL;');
      await sequelize.query('ALTER TABLE "Expenses" ADD COLUMN IF NOT EXISTS "voidReason" TEXT NULL;');
      console.log('✅ Columnas de anulación verificadas/agregadas en Expenses.');
    } catch (e) {
      console.error('❌ Error agregando columnas de anulación en Expenses:', e.message);
    }

    // 5. Crear/ajustar tablas nuevas si no existen
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
