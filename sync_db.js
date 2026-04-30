const { sequelize } = require('./src/models');

async function syncDb() {
  try {
    console.log('Intentando sincronizar la base de datos...');
    // alter: true intentará actualizar las columnas y ENUMs existentes
    await sequelize.sync({ alter: true });
    console.log('Base de datos sincronizada correctamente.');
    process.exit(0);
  } catch (err) {
    console.error('Error al sincronizar:', err);
    process.exit(1);
  }
}

syncDb();
