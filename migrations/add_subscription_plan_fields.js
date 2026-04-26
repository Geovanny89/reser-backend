/**
 * Migration: Agregar campos de plan de suscripción por usuarios a Business
 * Planes: basic (3 users), pro (5 users), premium (10 users)
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar columnas existentes
    const tableInfo = await queryInterface.describeTable('Businesses');
    
    // Plan de suscripción
    if (!tableInfo.subscriptionPlan) {
      await queryInterface.addColumn('Businesses', 'subscriptionPlan', {
        type: Sequelize.ENUM('basic', 'pro', 'premium'),
        defaultValue: 'basic',
        allowNull: false
      });
      console.log('✅ Campo subscriptionPlan agregado a Businesses');
    } else {
      console.log('⚠️ Campo subscriptionPlan ya existe en Businesses');
    }
    
    // Usuarios incluidos según el plan
    if (!tableInfo.includedUsers) {
      await queryInterface.addColumn('Businesses', 'includedUsers', {
        type: Sequelize.INTEGER,
        defaultValue: 3,
        allowNull: false
      });
      console.log('✅ Campo includedUsers agregado a Businesses');
    } else {
      console.log('⚠️ Campo includedUsers ya existe en Businesses');
    }
    
    // Usuarios adicionales contratados
    if (!tableInfo.additionalUsers) {
      await queryInterface.addColumn('Businesses', 'additionalUsers', {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      });
      console.log('✅ Campo additionalUsers agregado a Businesses');
    } else {
      console.log('⚠️ Campo additionalUsers ya existe en Businesses');
    }
    
    // Precio por usuario adicional
    if (!tableInfo.additionalUserPrice) {
      await queryInterface.addColumn('Businesses', 'additionalUserPrice', {
        type: Sequelize.INTEGER,
        defaultValue: 20000,
        allowNull: false
      });
      console.log('✅ Campo additionalUserPrice agregado a Businesses');
    } else {
      console.log('⚠️ Campo additionalUserPrice ya existe en Businesses');
    }
    
    // Total mensual calculado
    if (!tableInfo.monthlyTotal) {
      await queryInterface.addColumn('Businesses', 'monthlyTotal', {
        type: Sequelize.INTEGER,
        defaultValue: 70000,
        allowNull: false
      });
      console.log('✅ Campo monthlyTotal agregado a Businesses');
    } else {
      console.log('⚠️ Campo monthlyTotal ya existe en Businesses');
    }
    
    console.log('🎉 Campos de plan de suscripción procesados en Businesses');
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
