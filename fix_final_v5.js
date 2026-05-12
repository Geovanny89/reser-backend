const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

/**
 * Script Maestro de Migración V5 Final
 * Corrige TODAS las columnas faltantes en Appointments, Services y cash_movements
 * Ejecutar con: node fix_final_v5.js
 */
async function fixAllMissingColumns() {
  const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: false,
    }
  );

  const queryInterface = sequelize.getQueryInterface();

  console.log('🔍 Iniciando verificación exhaustiva de base de datos...');

  try {
    // 0. VERIFICAR TABLAS CRÍTICAS
    const tables = await queryInterface.showAllTables();
    console.log('📦 Tablas actuales:', tables.join(', '));

    const requiredTables = ['Appointments', 'Services', 'cash_movements', 'AppointmentReminderEvents'];
    for (const table of requiredTables) {
      if (!tables.includes(table) && !tables.includes(table.toLowerCase())) {
        console.log(`⚠️  ADVERTENCIA: La tabla ${table} parece no existir. Intentando sincronizar modelos...`);
        // No creamos tablas manualmente aquí para evitar conflictos de tipos complejos, 
        // sugerimos correr el servidor una vez con sync o usar migraciones oficiales.
      }
    }

    // === 1. TABLA: Appointments ===
    console.log('\n--- Verificando tabla Appointments ---');
    let appointmentTable;
    try {
      appointmentTable = await queryInterface.describeTable('Appointments');
    } catch (e) {
      console.log('⚠️ No se pudo describir Appointments, intentando appointments (minúscula)...');
      appointmentTable = await queryInterface.describeTable('appointments');
    }
    
    const apptCols = [
      { name: 'suppliesCost', type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      { name: 'messageFlowStatus', type: DataTypes.STRING(30), defaultValue: 'not_started' },
      { name: 'travelStartTime', type: DataTypes.DATE },
      { name: 'arrivalTime', type: DataTypes.DATE },
      { name: 'serviceStartTime', type: DataTypes.DATE },
      { name: 'workReport', type: DataTypes.JSON },
      { name: 'workEvidences', type: DataTypes.JSON },
      { name: 'clientSignature', type: DataTypes.TEXT },
      { name: 'clientSignatureName', type: DataTypes.STRING },
      { name: 'clientSignatureDate', type: DataTypes.DATE },
      { name: 'technicianStatus', type: DataTypes.STRING(30), defaultValue: 'not_started' },
      { name: 'additionalAmount', type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      { name: 'additionalNote', type: DataTypes.STRING },
      { name: 'basePrice', type: DataTypes.DECIMAL(10, 2) },
      { name: 'discountApplied', type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      { name: 'finalPrice', type: DataTypes.DECIMAL(10, 2) },
      { name: 'promotionId', type: DataTypes.UUID },
      { name: 'paymentMethod', type: DataTypes.STRING(20) },
      { name: 'whatsappReminderSent', type: DataTypes.BOOLEAN, defaultValue: false },
      { name: 'extendedDuration', type: DataTypes.INTEGER, defaultValue: 0 },
      { name: 'extraServices', type: DataTypes.JSON, defaultValue: [] },
      { name: 'referenceCode', type: DataTypes.STRING(8) },
      { name: 'source', type: DataTypes.STRING(30), defaultValue: 'web' }
    ];

    for (const col of apptCols) {
      if (!appointmentTable[col.name]) {
        console.log(`➕ Agregando columna ${col.name} a Appointments...`);
        try {
          await queryInterface.addColumn('Appointments', col.name, {
            type: col.type,
            defaultValue: col.defaultValue,
            allowNull: true
          });
        } catch (err) {
          await queryInterface.addColumn('appointments', col.name, {
            type: col.type,
            defaultValue: col.defaultValue,
            allowNull: true
          });
        }
      }
    }

    // === 2. TABLA: Services ===
    console.log('\n--- Verificando tabla Services ---');
    let serviceTable;
    try {
      serviceTable = await queryInterface.describeTable('Services');
    } catch (e) {
      serviceTable = await queryInterface.describeTable('services');
    }

    const svcCols = [
      { name: 'suppliesCost', type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      { name: 'isTechnicalService', type: DataTypes.BOOLEAN, defaultValue: false },
      { name: 'priceOptional', type: DataTypes.BOOLEAN, defaultValue: false },
      { name: 'hasEmployeeCommission', type: DataTypes.BOOLEAN, defaultValue: true }
    ];

    for (const col of svcCols) {
      if (!serviceTable[col.name]) {
        console.log(`➕ Agregando columna ${col.name} a Services...`);
        try {
          await queryInterface.addColumn('Services', col.name, {
            type: col.type,
            defaultValue: col.defaultValue,
            allowNull: true
          });
        } catch (err) {
          await queryInterface.addColumn('services', col.name, {
            type: col.type,
            defaultValue: col.defaultValue,
            allowNull: true
          });
        }
      }
    }

    // === 3. TABLA: cash_movements ===
    console.log('\n--- Verificando tabla cash_movements ---');
    let cashTable;
    try {
      cashTable = await queryInterface.describeTable('cash_movements');
    } catch (e) {
      cashTable = await queryInterface.describeTable('CashMovements');
    }

    const cashCols = [
      { name: 'suppliesCost', type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
      { name: 'isReversal', type: DataTypes.BOOLEAN, defaultValue: false },
      { name: 'reversesMovementId', type: DataTypes.UUID },
      { name: 'category', type: DataTypes.STRING, defaultValue: 'general' },
      { name: 'createdBy', type: DataTypes.UUID }
    ];

    for (const col of cashCols) {
      if (!cashTable[col.name]) {
        console.log(`➕ Agregando columna ${col.name} a cash_movements...`);
        try {
          await queryInterface.addColumn('cash_movements', col.name, {
            type: col.type,
            defaultValue: col.defaultValue,
            allowNull: true
          });
        } catch (err) {
          await queryInterface.addColumn('CashMovements', col.name, {
            type: col.type,
            defaultValue: col.defaultValue,
            allowNull: true
          });
        }
      }
    }

    console.log('\n✅ ¡MIGRACIÓN COMPLETADA EXITOSAMENTE!');
    console.log('💡 Reinicia el servidor en el VPS (pm2 restart all) para aplicar cambios.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error crítico durante la migración:', err);
    process.exit(1);
  }
}

fixAllMissingColumns();
