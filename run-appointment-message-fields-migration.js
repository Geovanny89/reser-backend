/**
 * Script para ejecutar la migración de campos de mensajes en citas
 * Ejecuta: node run-appointment-message-fields-migration.js
 */
const sequelize = require('./src/config/database');

async function runMigration() {
  try {
    console.log('🔧 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    // Verificar si las columnas ya existen
    const [columns] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'Appointments'
    `);

    const existingColumns = columns.map(c => c.column_name);

    // Agregar reminder12hSent
    if (!existingColumns.includes('reminder12hSent')) {
      console.log('📦 Agregando columna reminder12hSent...');
      await sequelize.query(`
        ALTER TABLE "Appointments"
        ADD COLUMN "reminder12hSent" BOOLEAN NOT NULL DEFAULT false
      `);
      console.log('✅ Columna reminder12hSent agregada');
    } else {
      console.log('ℹ️ Columna reminder12hSent ya existe');
    }

    // Agregar referenceMessageSent
    if (!existingColumns.includes('referenceMessageSent')) {
      console.log('📦 Agregando columna referenceMessageSent...');
      await sequelize.query(`
        ALTER TABLE "Appointments"
        ADD COLUMN "referenceMessageSent" BOOLEAN NOT NULL DEFAULT false
      `);
      console.log('✅ Columna referenceMessageSent agregada');
    } else {
      console.log('ℹ️ Columna referenceMessageSent ya existe');
    }

    // Agregar thankYouMessageSent
    if (!existingColumns.includes('thankYouMessageSent')) {
      console.log('📦 Agregando columna thankYouMessageSent...');
      await sequelize.query(`
        ALTER TABLE "Appointments"
        ADD COLUMN "thankYouMessageSent" BOOLEAN NOT NULL DEFAULT false
      `);
      console.log('✅ Columna thankYouMessageSent agregada');
    } else {
      console.log('ℹ️ Columna thankYouMessageSent ya existe');
    }

    // Agregar thankYouMessageSentAt
    if (!existingColumns.includes('thankYouMessageSentAt')) {
      console.log('📦 Agregando columna thankYouMessageSentAt...');
      await sequelize.query(`
        ALTER TABLE "Appointments"
        ADD COLUMN "thankYouMessageSentAt" TIMESTAMP NULL
      `);
      console.log('✅ Columna thankYouMessageSentAt agregada');
    } else {
      console.log('ℹ️ Columna thankYouMessageSentAt ya existe');
    }

    // Crear índices
    console.log('📦 Creando índices...');

    try {
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS appointments_reminder_12h_idx
        ON "Appointments"("reminder12hSent")
      `);
      console.log('✅ Índice appointments_reminder_12h_idx creado');
    } catch (e) {
      console.log('ℹ️ Índice appointments_reminder_12h_idx ya existe o error:', e.message);
    }

    try {
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS appointments_reference_msg_idx
        ON "Appointments"("referenceMessageSent")
      `);
      console.log('✅ Índice appointments_reference_msg_idx creado');
    } catch (e) {
      console.log('ℹ️ Índice appointments_reference_msg_idx ya existe o error:', e.message);
    }

    try {
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS appointments_thank_you_idx
        ON "Appointments"("thankYouMessageSent")
      `);
      console.log('✅ Índice appointments_thank_you_idx creado');
    } catch (e) {
      console.log('ℹ️ Índice appointments_thank_you_idx ya existe o error:', e.message);
    }

    console.log('\n✅ Migración completada exitosamente');

    // Verificar columnas
    const [results] = await sequelize.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'Appointments'
      AND column_name IN ('reminder12hSent', 'referenceMessageSent', 'thankYouMessageSent', 'thankYouMessageSentAt')
      ORDER BY column_name
    `);

    console.log('\n📋 Columnas agregadas:');
    results.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error en la migración:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runMigration();
