const { sequelize } = require('./src/models');

async function fixAll() {
  console.log('🔧 Iniciando corrección completa de migraciones...');
  const queryInterface = sequelize.getQueryInterface();
  
  try {
    // 1. Crear todas las tablas que faltan
    const tables = await queryInterface.showAllTables();
    
    // WhatsAppSessions
    if (!tables.includes('WhatsAppSessions')) {
      console.log('📦 Creando WhatsAppSessions...');
      await queryInterface.createTable('WhatsAppSessions', {
        id: { type: require('sequelize').DataTypes.UUID, defaultValue: require('sequelize').DataTypes.UUIDV4, primaryKey: true },
        businessId: { type: require('sequelize').DataTypes.UUID, allowNull: false },
        phoneNumber: { type: require('sequelize').DataTypes.STRING },
        sessionData: { type: require('sequelize').DataTypes.TEXT },
        status: { type: require('sequelize').DataTypes.STRING, defaultValue: 'disconnected' },
        qrCode: { type: require('sequelize').DataTypes.TEXT },
        lastActivity: { type: require('sequelize').DataTypes.DATE },
        createdAt: { type: require('sequelize').DataTypes.DATE, allowNull: false, defaultValue: require('sequelize').Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt: { type: require('sequelize').DataTypes.DATE, allowNull: false, defaultValue: require('sequelize').Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      console.log('✅ WhatsAppSessions creada');
    }

    // Promotions
    if (!tables.includes('Promotions')) {
      console.log('📦 Creando Promotions...');
      await queryInterface.createTable('Promotions', {
        id: { type: require('sequelize').DataTypes.UUID, defaultValue: require('sequelize').DataTypes.UUIDV4, primaryKey: true },
        businessId: { type: require('sequelize').DataTypes.UUID, allowNull: false },
        serviceId: { type: require('sequelize').DataTypes.UUID },
        name: { type: require('sequelize').DataTypes.STRING, allowNull: false },
        discountType: { type: require('sequelize').DataTypes.STRING },
        discountValue: { type: require('sequelize').DataTypes.DECIMAL(10, 2) },
        startDate: { type: require('sequelize').DataTypes.DATE },
        endDate: { type: require('sequelize').DataTypes.DATE },
        active: { type: require('sequelize').DataTypes.BOOLEAN, defaultValue: true },
        applyToAllServices: { type: require('sequelize').DataTypes.BOOLEAN, defaultValue: false },
        createdAt: { type: require('sequelize').DataTypes.DATE, allowNull: false },
        updatedAt: { type: require('sequelize').DataTypes.DATE, allowNull: false }
      });
      console.log('✅ Promotions creada');
    }

    // SystemSettings
    if (!tables.includes('SystemSettings')) {
      console.log('📦 Creando SystemSettings...');
      await queryInterface.createTable('SystemSettings', {
        id: { type: require('sequelize').DataTypes.UUID, defaultValue: require('sequelize').DataTypes.UUIDV4, primaryKey: true },
        key: { type: require('sequelize').DataTypes.STRING, allowNull: false, unique: true },
        value: { type: require('sequelize').DataTypes.TEXT },
        createdAt: { type: require('sequelize').DataTypes.DATE, allowNull: false },
        updatedAt: { type: require('sequelize').DataTypes.DATE, allowNull: false }
      });
      console.log('✅ SystemSettings creada');
    }

    // 2. Agregar columnas a Appointments
    const apptInfo = await queryInterface.describeTable('Appointments');
    const apptColumns = [
      { name: 'reminder24hSent', type: 'BOOLEAN', default: 'false' },
      { name: 'reminder2hSent', type: 'BOOLEAN', default: 'false' },
      { name: 'confirmed', type: 'BOOLEAN', default: 'false' },
      { name: 'confirmedAt', type: 'TIMESTAMP WITH TIME ZONE' },
      { name: 'rating', type: 'INTEGER' },
      { name: 'ratingComment', type: 'TEXT' },
      { name: 'ratingSent', type: 'BOOLEAN', default: 'false' },
      { name: 'ratingRequestSent', type: 'BOOLEAN', default: 'false' },
      { name: 'ratingRequestTime', type: 'TIMESTAMP WITH TIME ZONE' },
      { name: 'additionalAmount', type: 'DECIMAL(10,2)', default: '0' },
      { name: 'additionalNote', type: 'VARCHAR(255)' },
      { name: 'basePrice', type: 'DECIMAL(10,2)' },
      { name: 'discountApplied', type: 'DECIMAL(10,2)', default: '0' },
      { name: 'finalPrice', type: 'DECIMAL(10,2)' },
      { name: 'promotionId', type: 'UUID' },
      { name: 'paymentMethod', type: 'VARCHAR(50)' },
      { name: 'whatsappReminderSent', type: 'BOOLEAN', default: 'false' },
      { name: 'pendingAlertSent', type: 'BOOLEAN', default: 'false' },
      { name: 'pendingAlert30mSent', type: 'BOOLEAN', default: 'false' },
      { name: 'pendingAlert60mSent', type: 'BOOLEAN', default: 'false' },
    ];

    for (const col of apptColumns) {
      if (!apptInfo[col.name]) {
        console.log(`➕ Appointments.${col.name}...`);
        let sql = `ALTER TABLE "Appointments" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}`;
        if (col.default) sql += ` DEFAULT ${col.default}`;
        await sequelize.query(sql);
      }
    }

    // 3. Agregar columnas a Businesses
    const bizInfo = await queryInterface.describeTable('Businesses');
    const bizColumns = [
      { name: 'useParentWhatsApp', type: 'BOOLEAN', default: 'false' },
      { name: 'parentBusinessId', type: 'UUID' },
      { name: 'isBranch', type: 'BOOLEAN', default: 'false' },
      { name: 'showPaymentMethods', type: 'BOOLEAN', default: 'true' },
      { name: 'isTechnicalServices', type: 'BOOLEAN', default: 'false' },
    ];

    for (const col of bizColumns) {
      if (!bizInfo[col.name]) {
        console.log(`➕ Businesses.${col.name}...`);
        let sql = `ALTER TABLE "Businesses" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}`;
        if (col.default) sql += ` DEFAULT ${col.default}`;
        await sequelize.query(sql);
      }
    }

    // Fix gallery column type
    if (bizInfo.gallery) {
      console.log('🔧 Convirtiendo gallery a TEXT...');
      await sequelize.query('ALTER TABLE "Businesses" ALTER COLUMN "gallery" TYPE TEXT');
    }

    // 4. Agregar columnas a Services
    const svcInfo = await queryInterface.describeTable('Services');
    const svcColumns = [
      { name: 'imageUrl', type: 'VARCHAR(255)' },
      { name: 'isReservable', type: 'BOOLEAN', default: 'true' },
      { name: 'priceOptional', type: 'BOOLEAN', default: 'false' },
    ];

    for (const col of svcColumns) {
      if (!svcInfo[col.name]) {
        console.log(`➕ Services.${col.name}...`);
        let sql = `ALTER TABLE "Services" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}`;
        if (col.default) sql += ` DEFAULT ${col.default}`;
        await sequelize.query(sql);
      }
    }

    // 5. Agregar columnas a Employees
    const empInfo = await queryInterface.describeTable('Employees');
    const empColumns = [
      { name: 'specialty', type: 'VARCHAR(255)' },
      { name: 'description', type: 'TEXT' },
      { name: 'customSchedule', type: 'BOOLEAN', default: 'false' },
    ];

    for (const col of empColumns) {
      if (!empInfo[col.name]) {
        console.log(`➕ Employees.${col.name}...`);
        let sql = `ALTER TABLE "Employees" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}`;
        if (col.default) sql += ` DEFAULT ${col.default}`;
        await sequelize.query(sql);
      }
    }

    console.log('\n✅ Todas las migraciones completadas!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    process.exit();
  }
}

fixAll();
