/**
 * Script para ejecutar la migración de citas grupales
 * Ejecuta: node run-migration.js
 */
const sequelize = require('./src/config/database');

async function runMigration() {
  try {
    console.log('🔧 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    // Crear tabla AppointmentEmployees
    console.log('📦 Creando tabla AppointmentEmployees...');
    
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "AppointmentEmployees" (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        "appointmentId" UUID NOT NULL REFERENCES "Appointments"(id) ON DELETE CASCADE,
        "employeeId" UUID NOT NULL REFERENCES "Employees"(id) ON DELETE CASCADE,
        role VARCHAR(255),
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("appointmentId", "employeeId")
      )
    `);

    // Crear índices
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_appointment_employee_employeeid 
      ON "AppointmentEmployees"("employeeId")
    `);

    console.log('✅ Migración completada exitosamente');
    console.log('📝 La tabla AppointmentEmployees ha sido creada');
    
    // Verificar que se creó
    const [results] = await sequelize.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'AppointmentEmployees'
    `);
    
    console.log('\n📋 Estructura de la tabla:');
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
