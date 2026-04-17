/**
 * Migration: Add delayed appointment alert tracking fields
 * These fields track if push notifications were sent when appointments
 * haven't started (status not changed to 'attention') after scheduled time
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      await queryInterface.addColumn('Appointments', 'delayedAlert10mSent', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Indica si ya se envió alerta de atraso a los 10 min'
      }, { transaction });

      await queryInterface.addColumn('Appointments', 'delayedAlert30mSent', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Indica si ya se envió alerta de atraso a los 30 min'
      }, { transaction });

      await queryInterface.addColumn('Appointments', 'delayedAlert1hSent', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        comment: 'Indica si ya se envió alerta de atraso a la 1 hora'
      }, { transaction });

      await transaction.commit();
      console.log('✅ Columnas de alertas de atraso agregadas');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      await queryInterface.removeColumn('Appointments', 'delayedAlert10mSent', { transaction });
      await queryInterface.removeColumn('Appointments', 'delayedAlert30mSent', { transaction });
      await queryInterface.removeColumn('Appointments', 'delayedAlert1hSent', { transaction });
      
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
};
