/**
 * Script para agregar columnas de rating por email a Appointments
 * Ejecuta: node run-rating-email-migration.js
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
      AND column_name IN ('ratingEmailSent', 'ratingEmailSentAt', 'ratingSubmittedAt')
    `);
    
    const existingColumns = columns.map(c => c.column_name);
    console.log('📋 Columnas existentes:', existingColumns);

    // Agregar ratingEmailSent si no existe
    if (!existingColumns.includes('ratingEmailSent')) {
      console.log('📦 Agregando columna ratingEmailSent...');
      await sequelize.query(`
        ALTER TABLE "Appointments" 
        ADD COLUMN "ratingEmailSent" BOOLEAN DEFAULT false NOT NULL
      `);
      console.log('✅ Columna ratingEmailSent agregada');
    } else {
      console.log('⚠️ Columna ratingEmailSent ya existe');
    }

    // Agregar ratingEmailSentAt si no existe
    if (!existingColumns.includes('ratingEmailSentAt')) {
      console.log('📦 Agregando columna ratingEmailSentAt...');
      await sequelize.query(`
        ALTER TABLE "Appointments" 
        ADD COLUMN "ratingEmailSentAt" TIMESTAMP NULL
      `);
      console.log('✅ Columna ratingEmailSentAt agregada');
    } else {
      console.log('⚠️ Columna ratingEmailSentAt ya existe');
    }

    // Agregar ratingSubmittedAt si no existe
    if (!existingColumns.includes('ratingSubmittedAt')) {
      console.log('📦 Agregando columna ratingSubmittedAt...');
      await sequelize.query(`
        ALTER TABLE "Appointments" 
        ADD COLUMN "ratingSubmittedAt" TIMESTAMP NULL
      `);
      console.log('✅ Columna ratingSubmittedAt agregada');
    } else {
      console.log('⚠️ Columna ratingSubmittedAt ya existe');
    }

    console.log('\n✅ Migración completada exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en la migración:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runMigration();
