/**
 * Script para ejecutar la migración de IncomingMessages
 */

const { sequelize } = require('./src/models');
const migration = require('./migrations/add_incoming_messages');

async function runMigration() {
  console.log('🚀 Iniciando migración de IncomingMessages...');
  
  try {
    // Verificar conexión
    await sequelize.authenticate();
    console.log('✅ Conexión a BD establecida');
    
    // Ejecutar migración hacia arriba (up)
    await migration.up(sequelize.getQueryInterface(), require('sequelize'));
    
    console.log('✅ Migración completada exitosamente');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en migración:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Ejecutar
runMigration();
