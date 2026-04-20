/**
 * Script para ejecutar la migración que agrega la columna description a EmployeeVacations
 * Uso: node run-add-description-migration.js
 */
require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'reservas',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: console.log
  }
);

async function runMigration() {
  try {
    console.log('🔌 Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión establecida');

    // Verificar si la columna ya existe
    const [columns] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'EmployeeVacations' 
      AND column_name = 'description'
    `);

    if (columns.length > 0) {
      console.log('ℹ️ La columna "description" ya existe en EmployeeVacations');
      process.exit(0);
    }

    // Agregar la columna
    console.log('➕ Agregando columna "description" a EmployeeVacations...');
    await sequelize.query(`
      ALTER TABLE "EmployeeVacations" 
      ADD COLUMN "description" VARCHAR(255)
    `);
    
    console.log('✅ Migración completada exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en la migración:', error);
    process.exit(1);
  }
}

runMigration();
