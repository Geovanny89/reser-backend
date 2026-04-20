const sequelize = require('./src/config/database');
const { Umzug, SequelizeStorage } = require('umzug');
const path = require('path');

const umzug = new Umzug({
  migrations: {
    glob: 'migrations/*.js',
    resolve: ({ name, path: migrationPath }) => {
      const migration = require(migrationPath);
      return {
        name,
        up: async () => migration.up(sequelize.getQueryInterface(), sequelize.Sequelize),
        down: async () => migration.down(sequelize.getQueryInterface(), sequelize.Sequelize),
      };
    },
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});

async function run() {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexión a base de datos establecida');
    
    const migrations = await umzug.up();
    console.log('✅ Migraciones ejecutadas:', migrations.map(m => m.name));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error en migraciones:', error);
    process.exit(1);
  }
}

run();
