const { Sequelize } = require('sequelize');
require('dotenv').config();

let sequelize;

if (process.env.DB_DIALECT === 'sqlite') {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: process.env.DB_STORAGE || './kdice.sqlite',
    logging: false,
  });
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: 'postgres',
      logging: false,
      typeValidation: true,
    }
  );
}

// Probar la conexión inmediatamente
sequelize.authenticate()
  .then(() => console.log('🚀 Base de datos conectada correctamente'))
  .catch(err => console.error('❌ Error conectando a la base de datos:', err));

module.exports = sequelize;
