'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'Appointments';
    
    try {
      await queryInterface.addColumn(tableName, 'pendingAlert2hSent', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Indica si ya se envió alerta de 2 horas de cita pendiente'
      });
      console.log('[Migration] ✅ Campo pendingAlert2hSent agregado correctamente');
    } catch (error) {
      // Si el campo ya existe, no es un error grave
      if (error.message.includes('already exists')) {
        console.log('[Migration] ⚠️ Campo pendingAlert2hSent ya existe, omitiendo');
      } else {
        console.error('[Migration] ❌ Error agregando campo pendingAlert2hSent:', error.message);
        throw error;
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const tableName = 'Appointments';
    
    try {
      await queryInterface.removeColumn(tableName, 'pendingAlert2hSent');
      console.log('[Migration] ✅ Campo pendingAlert2hSent removido correctamente');
    } catch (error) {
      console.error('[Migration] ❌ Error removiendo campo pendingAlert2hSent:', error.message);
      throw error;
    }
  }
};
