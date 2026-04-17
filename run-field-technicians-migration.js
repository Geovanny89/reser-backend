/**
 * Script para ejecutar la migración de Técnicos a Domicilio
 */
const path = require('path');
require('dotenv').config();

const { Sequelize } = require('sequelize');
const migration = require('./migrations/add_field_technicians_support.js');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: console.log
  }
);

async function runMigration() {
  try {
    console.log('🚀 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');
    
    console.log('\n📦 Ejecutando migración de Técnicos a Domicilio...\n');
    
    const queryInterface = sequelize.getQueryInterface();
    
    await migration.up(queryInterface, Sequelize);
    
    console.log('\n✅ Migración completada exitosamente!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error ejecutando migración:', error.message);
    if (error.message.includes('already exists') || error.message.includes('ya existe')) {
      console.log('\nℹ️  Algunos campos ya existen. Puedes ignorar este error si la migración ya fue ejecutada parcialmente.');
    }
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

runMigration();
