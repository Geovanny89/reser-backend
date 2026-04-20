/**
 * Script para corregir los planes de suscripción de las empresas existentes
 * Actualiza los valores de includedUsers según el plan:
 * - basic: 2 empleados
 * - pro: 5 empleados  
 * - premium: 10 empleados
 */

require('dotenv').config();
const { sequelize } = require('../src/models');
const { Business } = require('../src/models');

const SUBSCRIPTION_PLANS = {
  basic: { name: 'Básico', price: 70000, includedUsers: 2 },
  pro: { name: 'Pro', price: 90000, includedUsers: 5 },
  premium: { name: 'Premium', price: 130000, includedUsers: 10 }
};

async function fixSubscriptionPlans() {
  try {
    console.log('🔧 Iniciando corrección de planes de suscripción...\n');
    
    // Conectar a la base de datos
    await sequelize.authenticate();
    console.log('✅ Conexión a base de datos establecida\n');
    
    // Obtener todas las empresas
    const businesses = await Business.findAll();
    console.log(`📊 Total de empresas encontradas: ${businesses.length}\n`);
    
    let updatedCount = 0;
    let errorCount = 0;
    const results = [];
    
    for (const business of businesses) {
      try {
        const currentPlan = business.subscriptionPlan || 'basic';
        const planInfo = SUBSCRIPTION_PLANS[currentPlan];
        
        const oldIncludedUsers = business.includedUsers;
        const newIncludedUsers = planInfo.includedUsers;
        const oldMonthlyTotal = business.monthlyTotal;
        const newMonthlyTotal = planInfo.price + (business.additionalUsers * 20000);
        
        // Solo actualizar si hay cambios
        if (oldIncludedUsers !== newIncludedUsers || oldMonthlyTotal !== newMonthlyTotal) {
          await business.update({
            includedUsers: newIncludedUsers,
            monthlyTotal: newMonthlyTotal
          });
          
          results.push({
            id: business.id,
            name: business.name,
            plan: currentPlan,
            oldIncludedUsers,
            newIncludedUsers,
            oldMonthlyTotal,
            newMonthlyTotal,
            status: '✅ Actualizado'
          });
          updatedCount++;
        } else {
          results.push({
            id: business.id,
            name: business.name,
            plan: currentPlan,
            includedUsers: newIncludedUsers,
            status: '⏭️  Sin cambios (ya correcto)'
          });
        }
        
      } catch (error) {
        console.error(`❌ Error actualizando empresa ${business.id}:`, error.message);
        results.push({
          id: business.id,
          name: business.name,
          status: '❌ Error',
          error: error.message
        });
        errorCount++;
      }
    }
    
    // Mostrar resumen
    console.log('\n📋 RESUMEN DE CAMBIOS:\n');
    console.log('='.repeat(80));
    
    results.forEach(r => {
      if (r.status.includes('Actualizado')) {
        console.log(`\n🏢 ${r.name} (ID: ${r.id})`);
        console.log(`   Plan: ${r.plan}`);
        console.log(`   Empleados incluidos: ${r.oldIncludedUsers} → ${r.newIncludedUsers}`);
        console.log(`   Total mensual: $${r.oldMonthlyTotal} → $${r.newMonthlyTotal}`);
        console.log(`   Estado: ${r.status}`);
      } else {
        console.log(`\n🏢 ${r.name} (ID: ${r.id})`);
        console.log(`   Plan: ${r.plan} | Empleados: ${r.includedUsers || r.newIncludedUsers}`);
        console.log(`   Estado: ${r.status}`);
      }
    });
    
    console.log('\n' + '='.repeat(80));
    console.log(`\n✅ Empresas actualizadas: ${updatedCount}`);
    console.log(`⏭️  Empresas sin cambios: ${businesses.length - updatedCount - errorCount}`);
    if (errorCount > 0) {
      console.log(`❌ Errores: ${errorCount}`);
    }
    console.log('\n🎉 ¡Corrección completada!\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

// Ejecutar
fixSubscriptionPlans();
