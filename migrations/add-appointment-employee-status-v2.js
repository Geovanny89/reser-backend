/**
 * Migration: Agregar campos de estado individual a AppointmentEmployee (versión simplificada)
 * Permite que cada empleado tenga su propio estado en una cita grupal
 */
module.exports = {
  up: async (queryInterface, Sequelize, helpers) => {
    const { columnExists } = helpers || {};
    
    try {
      console.log('🔄 Iniciando migración de AppointmentEmployee...');
      
      // Agregar columna status si no existe
      if (columnExists) {
        if (!(await columnExists('AppointmentEmployees', 'status'))) {
          await queryInterface.addColumn('AppointmentEmployees', 'status', {
            type: Sequelize.STRING(50),
            defaultValue: 'pending',
            allowNull: true
          });
          console.log('✅ Columna status agregada');
        } else {
          console.log('⚠️ Columna status ya existe');
        }
        
        // Agregar columna statusUpdatedAt si no existe
        if (!(await columnExists('AppointmentEmployees', 'statusUpdatedAt'))) {
          await queryInterface.addColumn('AppointmentEmployees', 'statusUpdatedAt', {
            type: Sequelize.DATE,
            allowNull: true
          });
          console.log('✅ Columna statusUpdatedAt agregada');
        } else {
          console.log('⚠️ Columna statusUpdatedAt ya existe');
        }
      } else {
        // Fallback si no se proporciona helper
        try {
          await queryInterface.addColumn('AppointmentEmployees', 'status', {
            type: Sequelize.STRING(50),
            defaultValue: 'pending',
            allowNull: true
          });
          console.log('✅ Columna status agregada');
        } catch (e) {
          if (e.message.includes('already exists')) {
            console.log('⚠️ Columna status ya existe');
          } else {
            throw e;
          }
        }
        
        try {
          await queryInterface.addColumn('AppointmentEmployees', 'statusUpdatedAt', {
            type: Sequelize.DATE,
            allowNull: true
          });
          console.log('✅ Columna statusUpdatedAt agregada');
        } catch (e) {
          if (e.message.includes('already exists')) {
            console.log('⚠️ Columna statusUpdatedAt ya existe');
          } else {
            throw e;
          }
        }
      }
      
      console.log('✅ Migración completada exitosamente');
    } catch (error) {
      console.error('❌ Error en migración:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('🔄 Revertiendo migración...');
      
      await queryInterface.removeColumn('AppointmentEmployees', 'status');
      await queryInterface.removeColumn('AppointmentEmployees', 'statusUpdatedAt');
      
      console.log('✅ Migración revertida');
    } catch (error) {
      console.error('❌ Error revertiendo migración:', error.message);
      throw error;
    }
  }
};
