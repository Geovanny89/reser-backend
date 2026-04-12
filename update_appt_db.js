const { sequelize } = require('./src/models');

async function updateAppointmentsTable() {
  console.log('Iniciando actualización de tabla Appointments...');
  try {
    await sequelize.authenticate();
    console.log('Autenticado');
    const queryInterface = sequelize.getQueryInterface();
    const tableInfo = await queryInterface.describeTable('Appointments');
    
    if (tableInfo.paymentMethod) {
      console.log('✅ La columna "paymentMethod" ya existe');
    } else {
      console.log('❌ La columna "paymentMethod" NO existe. Intentando agregarla...');
      // Usamos string simple para el método de pago en la base de datos para mayor flexibilidad inicial
      await queryInterface.addColumn('Appointments', 'paymentMethod', {
        type: require('sequelize').DataTypes.STRING,
        allowNull: true,
        comment: 'Método de pago: cash o transfer'
      });
      console.log('✅ Columna "paymentMethod" agregada con éxito');
    }
  } catch (error) {
    console.error('❌ Error fatal:', error);
  } finally {
    process.exit();
  }
}

updateAppointmentsTable();
