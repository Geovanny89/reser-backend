const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
  host: process.env.DB_HOST,
  dialect: process.env.DB_DIALECT,
  logging: false,
});

async function getIds() {
  try {
    const [businesses] = await sequelize.query('SELECT id, name FROM "Businesses" LIMIT 1');
    if (businesses.length === 0) return console.log('No hay negocios en la DB');

    const businessId = businesses[0].id;
    const [services] = await sequelize.query(`SELECT id, name FROM "Services" WHERE "businessId" = '${businessId}' LIMIT 1`);
    const [employees] = await sequelize.query(`SELECT id, name FROM "Users" WHERE "businessId" = '${businessId}' AND role = 'employee' LIMIT 1`);

    console.log('\n--- COPIA ESTOS IDS ---');
    console.log(`Negocio: ${businesses[0].name}`);
    console.log(`businessId: "${businessId}"`);
    console.log(`serviceId: "${services.length > 0 ? services[0].id : 'NO HAY SERVICIOS'}"`);
    console.log(`employeeId: "${employees.length > 0 ? employees[0].id : 'NO HAY EMPLEADOS'}"`);
    console.log('-----------------------\n');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await sequelize.close();
  }
}

getIds();
