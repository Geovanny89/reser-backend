const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

async function migrate() {
  const queryInterface = sequelize.getQueryInterface();
  
  console.log('Starting migration to add suppliesCost column...');
  
  try {
    // Add suppliesCost to Services
    console.log('Checking Services table...');
    const serviceTable = await queryInterface.describeTable('Services');
    if (!serviceTable.suppliesCost) {
      console.log('Adding suppliesCost to Services table...');
      await queryInterface.addColumn('Services', 'suppliesCost', {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
      });
      console.log('✅ suppliesCost added to Services');
    } else {
      console.log('ℹ️ suppliesCost already exists in Services');
    }

    // Add suppliesCost to Appointments
    console.log('Checking Appointments table...');
    const appointmentTable = await queryInterface.describeTable('Appointments');
    if (!appointmentTable.suppliesCost) {
      console.log('Adding suppliesCost to Appointments table...');
      await queryInterface.addColumn('Appointments', 'suppliesCost', {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        defaultValue: 0
      });
      console.log('✅ suppliesCost added to Appointments');
    } else {
      console.log('ℹ️ suppliesCost already exists in Appointments');
    }

    console.log('🚀 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
