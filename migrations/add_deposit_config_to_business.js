/**
 * Migration: Agregar campo depositConfig a Business
 * Configuración de anticipos/depositos con condiciones de penalidad
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar si la columna ya existe
    const tableInfo = await queryInterface.describeTable('Businesses');
    
    if ('depositConfig' in tableInfo) {
      console.log('⚠️ Campo depositConfig ya existe en Businesses, saltando...');
      return;
    }
    
    await queryInterface.addColumn('Businesses', 'depositConfig', {
      type: Sequelize.JSON,
      defaultValue: {
        required: false,
        amount: 0,
        percentage: 30,
        cancelationHours: 24,
        penaltyEnabled: true,
        termsText: 'El anticipo garantiza tu cita. Si cancelas con menos de 24 horas de anticipo o no asistes, el anticipo será retenido como penalidad. Puedes reagendar una vez sin costo adicional.'
      },
      allowNull: false
    });
    
    console.log('✅ Campo depositConfig agregado a Businesses');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Businesses', 'depositConfig');
    console.log('⬇️  Campo depositConfig removido de Businesses');
  }
};
