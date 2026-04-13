const { sequelize } = require('./src/models');

async function migrate() {
  console.log('🔄 Iniciando migración V5...');
  const queryInterface = sequelize.getQueryInterface();
  
  try {
    // 1. Crear tabla WhatsAppSessions si no existe
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('WhatsAppSessions')) {
      console.log('📦 Creando tabla WhatsAppSessions...');
      await queryInterface.createTable('WhatsAppSessions', {
        id: {
          type: require('sequelize').DataTypes.UUID,
          defaultValue: require('sequelize').DataTypes.UUIDV4,
          primaryKey: true
        },
        businessId: {
          type: require('sequelize').DataTypes.UUID,
          allowNull: false,
          references: {
            model: 'Businesses',
            key: 'id'
          }
        },
        phoneNumber: {
          type: require('sequelize').DataTypes.STRING,
          allowNull: true
        },
        sessionData: {
          type: require('sequelize').DataTypes.TEXT,
          allowNull: true
        },
        status: {
          type: require('sequelize').DataTypes.ENUM('disconnected', 'connecting', 'connected', 'qr_ready'),
          defaultValue: 'disconnected'
        },
        qrCode: {
          type: require('sequelize').DataTypes.TEXT,
          allowNull: true
        },
        lastActivity: {
          type: require('sequelize').DataTypes.DATE,
          allowNull: true
        },
        createdAt: {
          type: require('sequelize').DataTypes.DATE,
          allowNull: false
        },
        updatedAt: {
          type: require('sequelize').DataTypes.DATE,
          allowNull: false
        }
      });
      console.log('✅ Tabla WhatsAppSessions creada');
    } else {
      console.log('✅ Tabla WhatsAppSessions ya existe');
    }

    // 2. Verificar columnas en Appointments
    const tableInfo = await queryInterface.describeTable('Appointments');
    
    // Columnas a agregar
    const columnsToAdd = [
      { name: 'reminder24hSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'reminder2hSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'reminderSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'reminder30mSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'reminder24hScheduled', type: require('sequelize').DataTypes.DATE, allowNull: true },
      { name: 'reminder1hScheduled', type: require('sequelize').DataTypes.DATE, allowNull: true },
      { name: 'clientRating', type: require('sequelize').DataTypes.INTEGER, allowNull: true },
      { name: 'clientComment', type: require('sequelize').DataTypes.TEXT, allowNull: true },
      { name: 'ratingRequestSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'ratingRequestTime', type: require('sequelize').DataTypes.DATE, allowNull: true },
      { name: 'paymentMethod', type: require('sequelize').DataTypes.STRING, allowNull: true },
      { name: 'pendingAlertSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'pendingAlert30mSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'pendingAlert60mSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'confirmed', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'confirmedAt', type: require('sequelize').DataTypes.DATE, allowNull: true },
      { name: 'rating', type: require('sequelize').DataTypes.INTEGER, allowNull: true },
      { name: 'promotionId', type: require('sequelize').DataTypes.UUID, allowNull: true },
      { name: 'whatsappReminderSent', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
    ];

    for (const col of columnsToAdd) {
      if (!tableInfo[col.name]) {
        console.log(`➕ Agregando columna ${col.name}...`);
        await queryInterface.addColumn('Appointments', col.name, {
          type: col.type,
          allowNull: col.allowNull !== undefined ? col.allowNull : true,
          defaultValue: col.defaultValue
        });
        console.log(`✅ Columna ${col.name} agregada`);
      } else {
        console.log(`✅ Columna ${col.name} ya existe`);
      }
    }

    // 3. Verificar columnas en Businesses
    const businessInfo = await queryInterface.describeTable('Businesses');
    
    const businessColumns = [
      { name: 'useParentWhatsApp', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'parentBusinessId', type: require('sequelize').DataTypes.UUID, allowNull: true },
      { name: 'isBranch', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
      { name: 'showPaymentMethods', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: true },
    ];

    for (const col of businessColumns) {
      if (!businessInfo[col.name]) {
        console.log(`➕ Agregando columna ${col.name} a Businesses...`);
        await queryInterface.addColumn('Businesses', col.name, {
          type: col.type,
          allowNull: col.allowNull !== undefined ? col.allowNull : true,
          defaultValue: col.defaultValue
        });
        console.log(`✅ Columna ${col.name} agregada a Businesses`);
      } else {
        console.log(`✅ Columna ${col.name} ya existe en Businesses`);
      }
    }

    // 4. Verificar columnas en Services
    const serviceInfo = await queryInterface.describeTable('Services');
    
    const serviceColumns = [
      { name: 'isReservable', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: true },
      { name: 'priceOptional', type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
    ];

    for (const col of serviceColumns) {
      if (!serviceInfo[col.name]) {
        console.log(`➕ Agregando columna ${col.name} a Services...`);
        await queryInterface.addColumn('Services', col.name, {
          type: col.type,
          allowNull: true,
          defaultValue: col.defaultValue
        });
        console.log(`✅ Columna ${col.name} agregada a Services`);
      } else {
        console.log(`✅ Columna ${col.name} ya existe en Services`);
      }
    }

    // 5. Verificar columnas en Employees
    const employeeInfo = await queryInterface.describeTable('Employees');
    
    if (!employeeInfo.customSchedule) {
      console.log('➕ Agregando columna customSchedule a Employees...');
      await queryInterface.addColumn('Employees', 'customSchedule', {
        type: require('sequelize').DataTypes.BOOLEAN,
        defaultValue: false
      });
      console.log('✅ Columna customSchedule agregada');
    }

    console.log('\n🎉 Migración V5 completada exitosamente!');
    
  } catch (error) {
    console.error('❌ Error en migración:', error.message);
    console.error(error.stack);
  } finally {
    process.exit();
  }
}

migrate();
