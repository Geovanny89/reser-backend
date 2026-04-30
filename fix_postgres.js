const { sequelize } = require('./src/models');

async function fixPostgresEnums() {
  try {
    console.log('Corrigiendo ENUMs en Postgres...');

    // Añadir estados a subscriptionStatus
    // Usamos 'IF NOT EXISTS' para no fallar si ya están
    try {
      await sequelize.query("ALTER TYPE \"enum_Businesses_subscriptionStatus\" ADD VALUE IF NOT EXISTS 'paid'");
      console.log('Valor "paid" añadido.');
    } catch (e) { console.log('Nota: "paid" ya existía o no se pudo añadir.'); }

    try {
      await sequelize.query("ALTER TYPE \"enum_Businesses_subscriptionStatus\" ADD VALUE IF NOT EXISTS 'overdue'");
      console.log('Valor "overdue" añadido.');
    } catch (e) { console.log('Nota: "overdue" ya existía o no se pudo añadir.'); }

    console.log('Proceso de corrección de Postgres finalizado.');
    process.exit(0);
  } catch (err) {
    console.error('Error crítico en la corrección:', err);
    process.exit(1);
  }
}

fixPostgresEnums();
