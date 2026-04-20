/**
 * Script para ejecutar la migración de campos de suscripción
 * Ejecuta: node run-subscription-migration.js
 */
const sequelize = require('./src/config/database');

async function runMigration() {
  try {
    console.log('🔧 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    // Agregar campos de suscripción
    console.log('📦 Agregando campos de suscripción a Businesses...');
    
    // 1. Agregar subscriptionPlan
    try {
      await sequelize.query(`
        ALTER TABLE "Businesses" 
        ADD COLUMN IF NOT EXISTS "subscriptionPlan" VARCHAR(255) DEFAULT 'basic'
      `);
      console.log('✅ Campo subscriptionPlan agregado');
    } catch (e) {
      console.log('ℹ️ subscriptionPlan ya existe o error:', e.message);
    }
    
    // 2. Agregar includedUsers
    try {
      await sequelize.query(`
        ALTER TABLE "Businesses" 
        ADD COLUMN IF NOT EXISTS "includedUsers" INTEGER DEFAULT 3
      `);
      console.log('✅ Campo includedUsers agregado');
    } catch (e) {
      console.log('ℹ️ includedUsers ya existe o error:', e.message);
    }
    
    // 3. Agregar additionalUsers
    try {
      await sequelize.query(`
        ALTER TABLE "Businesses" 
        ADD COLUMN IF NOT EXISTS "additionalUsers" INTEGER DEFAULT 0
      `);
      console.log('✅ Campo additionalUsers agregado');
    } catch (e) {
      console.log('ℹ️ additionalUsers ya existe o error:', e.message);
    }
    
    // 4. Agregar additionalUserPrice
    try {
      await sequelize.query(`
        ALTER TABLE "Businesses" 
        ADD COLUMN IF NOT EXISTS "additionalUserPrice" INTEGER DEFAULT 20000
      `);
      console.log('✅ Campo additionalUserPrice agregado');
    } catch (e) {
      console.log('ℹ️ additionalUserPrice ya existe o error:', e.message);
    }
    
    // 5. Agregar monthlyTotal
    try {
      await sequelize.query(`
        ALTER TABLE "Businesses" 
        ADD COLUMN IF NOT EXISTS "monthlyTotal" INTEGER DEFAULT 70000
      `);
      console.log('✅ Campo monthlyTotal agregado');
    } catch (e) {
      console.log('ℹ️ monthlyTotal ya existe o error:', e.message);
    }
    
    // Actualizar registros existentes
    console.log('🔄 Actualizando registros existentes...');
    await sequelize.query(`
      UPDATE "Businesses" 
      SET "subscriptionPlan" = 'basic',
          "includedUsers" = 3,
          "additionalUsers" = 0,
          "additionalUserPrice" = 20000,
          "monthlyTotal" = 70000
      WHERE "subscriptionPlan" IS NULL
    `);
    console.log('✅ Registros actualizados');

    // Registrar la migración en SequelizeMeta para que no se ejecute de nuevo
    try {
      await sequelize.query(`
        INSERT INTO "SequelizeMeta" (name) 
        VALUES ('add_subscription_plan_fields.js')
        ON CONFLICT (name) DO NOTHING
      `);
      console.log('✅ Migración registrada en SequelizeMeta');
    } catch (e) {
      console.log('ℹ️ No se pudo registrar en SequelizeMeta:', e.message);
    }

    console.log('\n🎉 Migración de suscripción completada exitosamente!');
    
    // Verificar columnas
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Businesses' 
      AND column_name IN ('subscriptionPlan', 'includedUsers', 'additionalUsers', 'additionalUserPrice', 'monthlyTotal')
      ORDER BY column_name
    `);
    
    console.log('\n📋 Campos de suscripción en Businesses:');
    results.forEach(col => {
      console.log(`  ✓ ${col.column_name}`);
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
