const { sequelize } = require('./models');

/**
 * Script de migración para el VPS - Corrige columnas faltantes de la V5
 * Ejecutar con: node run-v5-final-migration.js
 */
async function fixMissingColumns() {
  const queryInterface = sequelize.getQueryInterface();

  console.log('🔍 Iniciando migración de columnas faltantes para V5 Final...');

  try {
    // === 1. MIGRACIÓN PARA TABLA: Appointments ===
    const appointmentTable = await queryInterface.describeTable('Appointments');
    
    const apptCols = [
      { name: 'suppliesCost', type: require('sequelize').DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      { name: 'messageFlowStatus', type: require('sequelize').DataTypes.STRING(30), defaultValue: 'not_started' },
      { name: 'travelStartTime', type: require('sequelize').DataTypes.DATE },
      { name: 'arrivalTime', type: require('sequelize').DataTypes.DATE },
      { name: 'serviceStartTime', type: require('sequelize').DataTypes.DATE },
      { name: 'workReport', type: require('sequelize').DataTypes.JSON },
      { name: 'workEvidences', type: require('sequelize').DataTypes.JSON },
      { name: 'clientSignature', type: require('sequelize').DataTypes.TEXT },
      { name: 'clientSignatureName', type: require('sequelize').DataTypes.STRING },
      { name: 'clientSignatureDate', type: require('sequelize').DataTypes.DATE }
    ];

    for (const col of apptCols) {
      if (!appointmentTable[col.name]) {
        console.log(`➕ Agregando columna ${col.name} a Appointments...`);
        await queryInterface.addColumn('Appointments', col.name, {
          type: col.type,
          defaultValue: col.defaultValue,
          allowNull: true
        });
      }
    }

    // Caso especial para ENUM technicianStatus (PostgreSQL requiere cuidado)
    if (!appointmentTable.technicianStatus) {
      console.log('➕ Agregando technicianStatus a Appointments...');
      try {
        await queryInterface.addColumn('Appointments', 'technicianStatus', {
          type: require('sequelize').DataTypes.STRING(30), // Usamos STRING por simplicidad en migraciones rápidas
          defaultValue: 'not_started'
        });
      } catch (e) {
        console.warn('⚠️ Nota: No se pudo agregar technicianStatus como STRING, intentando omitir.');
      }
    }

    // === 2. MIGRACIÓN PARA TABLA: Services ===
    const serviceTable = await queryInterface.describeTable('Services');

    const svcCols = [
      { name: 'suppliesCost', type: require('sequelize').DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      { name: 'isTechnicalService', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'priceOptional', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'hasEmployeeCommission', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: true }
    ];

    for (const col of svcCols) {
      if (!serviceTable[col.name]) {
        console.log(`➕ Agregando columna ${col.name} a Services...`);
        await queryInterface.addColumn('Services', col.name, {
          type: col.type,
          defaultValue: col.defaultValue,
          allowNull: true
        });
      }
    }

    console.log('\n✅ ¡MIGRACIÓN COMPLETADA EXITOSAMENTE!');
    console.log('💡 Reinicia el servidor en el VPS (pm2 restart all) para aplicar cambios.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error crítico durante la migración:', err);
    process.exit(1);
  }
}

fixMissingColumns();
