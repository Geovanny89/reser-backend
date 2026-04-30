const { sequelize } = require('./src/models');

async function checkEnums() {
  try {
    console.log('Consultando valores permitidos para subscriptionStatus...');
    const [results] = await sequelize.query(`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      WHERE pg_type.typname = 'enum_Businesses_subscriptionStatus';
    `);
    
    console.log('Valores actuales en DB:', results.map(r => r.enumlabel).join(', '));
    process.exit(0);
  } catch (err) {
    console.error('Error al consultar:', err);
    process.exit(1);
  }
}

checkEnums();
