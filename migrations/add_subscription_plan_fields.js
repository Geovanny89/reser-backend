/**
 * Migration: Agregar campos de plan de suscripción por usuarios a Business
 * Planes: basic (2 users), pro (3 users), premium (5 users)
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Plan de suscripción
    await queryInterface.addColumn('Businesses', 'subscriptionPlan', {
      type: Sequelize.ENUM('basic', 'pro', 'premium'),
      defaultValue: 'basic',
      allowNull: false
    });
    
    // Usuarios incluidos según el plan
    await queryInterface.addColumn('Businesses', 'includedUsers', {
      type: Sequelize.INTEGER,
      defaultValue: 2,
      allowNull: false
    });
    
    // Usuarios adicionales contratados
    await queryInterface.addColumn('Businesses', 'additionalUsers', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false
    });
    
    // Precio por usuario adicional
    await queryInterface.addColumn('Businesses', 'additionalUserPrice', {
      type: Sequelize.INTEGER,
      defaultValue: 20000,
      allowNull: false
    });
    
    // Total mensual calculado
    await queryInterface.addColumn('Businesses', 'monthlyTotal', {
      type: Sequelize.INTEGER,
      defaultValue: 70000,
      allowNull: false
    });
    
    console.log('✅ Campos de plan de suscripción agregados a Businesses');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Businesses', 'subscriptionPlan');
    await queryInterface.removeColumn('Businesses', 'includedUsers');
    await queryInterface.removeColumn('Businesses', 'additionalUsers');
    await queryInterface.removeColumn('Businesses', 'additionalUserPrice');
    await queryInterface.removeColumn('Businesses', 'monthlyTotal');
    
    // Eliminar el tipo ENUM
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Businesses_subscriptionPlan";');
    
    console.log('⬇️  Campos de plan de suscripción removidos de Businesses');
  }
};
