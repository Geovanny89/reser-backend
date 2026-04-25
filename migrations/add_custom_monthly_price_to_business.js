/**
 * Migration: Agregar campo de precio mensual personalizado a Business
 * Permite override del precio calculado por el plan para casos especiales
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('Businesses');

    if (!tableInfo.customMonthlyPrice) {
      await queryInterface.addColumn('Businesses', 'customMonthlyPrice', {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        comment: 'Precio mensual personalizado (override del plan). Si es null, se usa el precio del plan.'
      });
      console.log('✅ Campo customMonthlyPrice agregado a Businesses');
    } else {
      console.log('ℹ️ Campo customMonthlyPrice ya existe en Businesses');
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('Businesses');

    if (tableInfo.customMonthlyPrice) {
      await queryInterface.removeColumn('Businesses', 'customMonthlyPrice');
      console.log('⬇️  Campo customMonthlyPrice removido de Businesses');
    }
  }
};
