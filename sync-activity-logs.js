const sequelize = require('./src/config/database');
const { ActivityLog } = require('./src/models');

async function sync() {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexión a base de datos establecida');
    
    // Solo sincronizar el modelo ActivityLog
    await ActivityLog.sync({ alter: true });
    console.log('✅ Tabla ActivityLogs creada/actualizada correctamente');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

sync();
