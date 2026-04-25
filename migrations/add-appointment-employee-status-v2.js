/**
 * Migration: Agregar campos de estado individual a AppointmentEmployee (versión simplificada)
 * Permite que cada empleado tenga su propio estado en una cita grupal
 */
const { sequelize } = require('../src/models');

module.exports = {
  up: async () => {
    try {
      console.log('🔄 Iniciando migración de AppointmentEmployee...');
      
      // Verificar columnas existentes
      const [results] = await sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'AppointmentEmployees'
      `);
      
      const existingColumns = results.map(r => r.column_name);
      console.log('Columnas existentes:', existingColumns);
      
      // Agregar columna status si no existe
      if (!existingColumns.includes('status')) {
        await sequelize.query(`
          ALTER TABLE "AppointmentEmployees" 
          ADD COLUMN status VARCHAR(50) DEFAULT 'pending'
        `);
        console.log('✅ Columna status agregada');
      } else {
        console.log('⚠️ Columna status ya existe');
      }
      
      // Agregar columna statusUpdatedAt si no existe
      if (!existingColumns.includes('statusUpdatedAt')) {
        await sequelize.query(`
          ALTER TABLE "AppointmentEmployees" 
          ADD COLUMN "statusUpdatedAt" TIMESTAMP
        `);
        console.log('✅ Columna statusUpdatedAt agregada');
      } else {
        console.log('⚠️ Columna statusUpdatedAt ya existe');
      }
      
      // Crear índice si no existe
      const [indexes] = await sequelize.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'appointmentemployees' 
        AND indexname = 'appointment_employees_status'
      `);
      
      if (indexes.length === 0) {
        await sequelize.query(`
          CREATE INDEX "appointment_employees_status" 
          ON "AppointmentEmployees" (status)
        `);
        console.log('✅ Índice status creado');
      } else {
        console.log('⚠️ Índice status ya existe');
      }
      
      console.log('✅ Migración completada exitosamente');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error en migración:', error.message);
      process.exit(1);
    }
  },

  down: async () => {
    try {
      console.log('🔄 Revertiendo migración...');
      
      await sequelize.query(`ALTER TABLE "AppointmentEmployees" DROP COLUMN IF EXISTS status`);
      await sequelize.query(`ALTER TABLE "AppointmentEmployees" DROP COLUMN IF EXISTS "statusUpdatedAt"`);
      await sequelize.query(`DROP INDEX IF EXISTS "appointment_employees_status"`);
      
      console.log('✅ Migración revertida');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error revertiendo migración:', error.message);
      process.exit(1);
    }
  }
};
