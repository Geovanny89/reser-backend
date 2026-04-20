/**
 * Script para corregir los planes de suscripción de las sucursales existentes
 * Copia los valores del negocio padre a las sucursales
 */

require('dotenv').config();
const { sequelize } = require('../src/models');
const { Business } = require('../src/models');

async function fixBranchSubscriptions() {
  try {
    console.log('🔧 Corrigiendo planes de suscripción de sucursales...\n');
    
    await sequelize.authenticate();
    console.log('✅ Conectado a la base de datos\n');
    
    // Obtener todas las sucursales (negocios con parentBusinessId)
    const branches = await Business.findAll({
      where: {
        parentBusinessId: {
          [require('sequelize').Op.ne]: null
        }
      }
    });
    
    console.log(`📊 Total de sucursales encontradas: ${branches.length}\n`);
    
    let updatedCount = 0;
    let errorCount = 0;
    const results = [];
    
    for (const branch of branches) {
      try {
        // Buscar el negocio padre
        const parent = await Business.findByPk(branch.parentBusinessId);
        
        if (!parent) {
          results.push({
            id: branch.id,
            name: branch.name,
            status: '⚠️  Negocio padre no encontrado'
          });
          continue;
        }
        
        // Verificar si hay diferencias
        const needsUpdate = 
          branch.subscriptionPlan !== parent.subscriptionPlan ||
          branch.includedUsers !== parent.includedUsers ||
          branch.additionalUsers !== parent.additionalUsers ||
          branch.monthlyTotal !== parent.monthlyTotal;
        
        if (needsUpdate) {
          const oldPlan = branch.subscriptionPlan;
          const oldUsers = branch.includedUsers;
          
          await branch.update({
            subscriptionPlan: parent.subscriptionPlan,
            includedUsers: parent.includedUsers,
            additionalUsers: parent.additionalUsers,
            monthlyTotal: parent.monthlyTotal,
            additionalUserPrice: parent.additionalUserPrice
          });
          
          results.push({
            id: branch.id,
            name: branch.name,
            parentName: parent.name,
            oldPlan,
            newPlan: parent.subscriptionPlan,
            oldUsers,
            newUsers: parent.includedUsers,
            status: '✅ Actualizado'
          });
          updatedCount++;
        } else {
          results.push({
            id: branch.id,
            name: branch.name,
            parentName: parent.name,
            plan: branch.subscriptionPlan,
            users: branch.includedUsers,
            status: '⏭️  Sin cambios (ya correcto)'
          });
        }
        
      } catch (error) {
        console.error(`❌ Error actualizando sucursal ${branch.id}:`, error.message);
        results.push({
          id: branch.id,
          name: branch.name,
          status: '❌ Error',
          error: error.message
        });
        errorCount++;
      }
    }
    
    // Mostrar resumen
    console.log('\n📋 RESULTADOS:\n');
    console.log('='.repeat(90));
    
    results.forEach(r => {
      console.log(`\n🏢 Sucursal: ${r.name} (ID: ${r.id})`);
      if (r.parentName) console.log(`   Negocio padre: ${r.parentName}`);
      
      if (r.status.includes('Actualizado')) {
        console.log(`   Plan: ${r.oldPlan} → ${r.newPlan}`);
        console.log(`   Empleados: ${r.oldUsers} → ${r.newUsers}`);
      } else if (r.status.includes('Sin cambios')) {
        console.log(`   Plan: ${r.plan} | Empleados: ${r.users}`);
      }
      
      console.log(`   Estado: ${r.status}`);
    });
    
    console.log('\n' + '='.repeat(90));
    console.log(`\n✅ Sucursales actualizadas: ${updatedCount}`);
    console.log(`⏭️  Sin cambios: ${branches.length - updatedCount - errorCount}`);
    if (errorCount > 0) console.log(`❌ Errores: ${errorCount}`);
    console.log('\n🎉 ¡Corrección completada!\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  }
}

fixBranchSubscriptions();
