/**
 * Migración: Agregar campo messageFlowStatus a Appointments
 * Este campo controla el flujo de mensajes automáticos independientemente del status de la cita
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;
    
    // Verificar si la columna ya existe
    const tableInfo = await queryInterface.describeTable('Appointments');
    
    if (!tableInfo.messageFlowStatus) {
      console.log('[Migration] Agregando columna messageFlowStatus a Appointments...');
      
      await queryInterface.addColumn('Appointments', 'messageFlowStatus', {
        type: DataTypes.STRING(30),
        defaultValue: 'not_started',
        allowNull: false,
        comment: 'Estado del flujo: not_started, awaiting_confirmation, awaiting_rating, completed'
      });
      
      // Crear índice para búsquedas rápidas
      await queryInterface.addIndex('Appointments', ['messageFlowStatus'], {
        name: 'idx_appointments_message_flow_status'
      });
      
      console.log('[Migration] ✓ Columna messageFlowStatus agregada exitosamente');
    } else {
      console.log('[Migration] ℹ️ La columna messageFlowStatus ya existe');
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Eliminar índice primero
    try {
      await queryInterface.removeIndex('Appointments', 'idx_appointments_message_flow_status');
    } catch (e) {
      // Ignorar si el índice no existe
    }
    
    // Eliminar columna
    await queryInterface.removeColumn('Appointments', 'messageFlowStatus');
    
    console.log('[Migration] ✓ Columna messageFlowStatus eliminada');
  }
};
