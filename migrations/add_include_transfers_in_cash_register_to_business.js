/**
 * Migration: Agregar campo includeTransfersInCashRegister a Business
 * Configuración para incluir transferencias en la caja registradora
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar si la columna ya existe
    const tableInfo = await queryInterface.describeTable('Businesses');
    
    if ('includeTransfersInCashRegister' in tableInfo) {
      console.log('⚠️ Campo includeTransfersInCashRegister ya existe en Businesses, saltando...');
      return;
    }
    
    await queryInterface.addColumn('Businesses', 'includeTransfersInCashRegister', {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
      allowNull: false
    });
    
    console.log('✅ Campo includeTransfersInCashRegister agregado a Businesses');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Businesses', 'includeTransfersInCashRegister');
    console.log('⬇️  Campo includeTransfersInCashRegister removido de Businesses');
  }
};
