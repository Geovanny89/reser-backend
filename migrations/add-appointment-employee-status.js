/**
 * Migration: Agregar campos de estado individual a AppointmentEmployee
 * Permite que cada empleado tenga su propio estado en una cita grupal
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar si la columna status ya existe
    const tableInfo = await queryInterface.describeTable('AppointmentEmployees');
    
    if (!tableInfo.status) {
      await queryInterface.addColumn('AppointmentEmployees', 'status', {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: 'pending',
        comment: 'Estado individual del empleado en esta cita (pending, on_the_way, arrived, in_progress, done)'
      });
      console.log('✅ Columna status agregada a AppointmentEmployees');
    } else {
      console.log('⚠️ Columna status ya existe en AppointmentEmployees');
    }

    if (!tableInfo.statusUpdatedAt) {
      await queryInterface.addColumn('AppointmentEmployees', 'statusUpdatedAt', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Fecha de última actualización del estado del empleado'
      });
      console.log('✅ Columna statusUpdatedAt agregada a AppointmentEmployees');
    } else {
      console.log('⚠️ Columna statusUpdatedAt ya existe en AppointmentEmployees');
    }

    // Crear índice en status si no existe
    const indexes = await queryInterface.showIndex('AppointmentEmployees');
    const statusIndexExists = indexes.some(idx => idx.name === 'appointment_employees_status');
    
    if (!statusIndexExists) {
      await queryInterface.addIndex('AppointmentEmployees', ['status'], {
        name: 'appointment_employees_status'
      });
      console.log('✅ Índice status agregado a AppointmentEmployees');
    } else {
      console.log('⚠️ Índice status ya existe en AppointmentEmployees');
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('AppointmentEmployees', 'status');
    await queryInterface.removeColumn('AppointmentEmployees', 'statusUpdatedAt');
    await queryInterface.removeIndex('AppointmentEmployees', 'appointment_employees_status');
    console.log('✅ Campos de estado eliminados de AppointmentEmployees');
  }
};
