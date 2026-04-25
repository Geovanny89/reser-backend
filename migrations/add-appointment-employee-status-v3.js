/**
 * Migration: Agregar campos de estado individual a AppointmentEmployee (SQL directo)
 */
require('dotenv').config();
const { Pool } = require('pg');

// Configuración de conexión desde variables de entorno (mismas que database.js)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'kdice',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || ''
});

async function runMigration() {
  try {
    console.log('🔄 Conectando a la base de datos...');
    await pool.connect();
    console.log('✅ Conectado');

    // Verificar columnas existentes
    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'appointmentemployees'
    `);
    
    const existingColumns = result.rows.map(r => r.column_name);
    console.log('Columnas existentes:', existingColumns);
    
    // Agregar columna status si no existe
    if (!existingColumns.includes('status')) {
      await pool.query(`ALTER TABLE "AppointmentEmployees" ADD COLUMN status VARCHAR(50) DEFAULT 'pending'`);
      console.log('✅ Columna status agregada');
    } else {
      console.log('⚠️ Columna status ya existe');
    }
    
    // Agregar columna statusUpdatedAt si no existe
    if (!existingColumns.includes('statusUpdatedAt')) {
      await pool.query(`ALTER TABLE "AppointmentEmployees" ADD COLUMN "statusUpdatedAt" TIMESTAMP`);
      console.log('✅ Columna statusUpdatedAt agregada');
    } else {
      console.log('⚠️ Columna statusUpdatedAt ya existe');
    }
    
    // Crear índice si no existe
    const indexResult = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'appointmentemployees' 
      AND indexname = 'appointment_employees_status'
    `);
    
    if (indexResult.rows.length === 0) {
      await pool.query(`CREATE INDEX "appointment_employees_status" ON "AppointmentEmployees" (status)`);
      console.log('✅ Índice status creado');
    } else {
      console.log('⚠️ Índice status ya existe');
    }
    
    console.log('✅ Migración completada exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en migración:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
