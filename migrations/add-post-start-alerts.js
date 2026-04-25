'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tableName = 'Appointments';
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // Agregar campos para alertas post-cita
      await queryInterface.addColumn(tableName, 'postStartAlert15mSent', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Indica si ya se envió alerta de 15 min post-inicio de cita'
      }, { transaction });

      await queryInterface.addColumn(tableName, 'postStartAlert30mSent', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Indica si ya se envió alerta de 30 min post-inicio de cita'
      }, { transaction });

      await queryInterface.addColumn(tableName, 'postStartAlert1hSent', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Indica si ya se envió alerta de 1 hora post-inicio de cita'
      }, { transaction });

      await queryInterface.addColumn(tableName, 'postStartAlert2hSent', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Indica si ya se envió alerta de 2 horas post-inicio de cita'
      }, { transaction });

      await transaction.commit();
      console.log('[Migration] ✅ Campos postStartAlert agregados correctamente');
    } catch (error) {
      await transaction.rollback();
      console.error('[Migration] ❌ Error agregando campos postStartAlert:', error.message);
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const tableName = 'Appointments';
    const transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn(tableName, 'postStartAlert15mSent', { transaction });
      await queryInterface.removeColumn(tableName, 'postStartAlert30mSent', { transaction });
      await queryInterface.removeColumn(tableName, 'postStartAlert1hSent', { transaction });
      await queryInterface.removeColumn(tableName, 'postStartAlert2hSent', { transaction });

      await transaction.commit();
      console.log('[Migration] ✅ Campos postStartAlert removidos correctamente');
    } catch (error) {
      await transaction.rollback();
      console.error('[Migration] ❌ Error removiendo campos postStartAlert:', error.message);
      throw error;
    }
  }
};
