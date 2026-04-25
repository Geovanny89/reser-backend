module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar si la columna ya existe
    const tableInfo = await queryInterface.describeTable('Appointments');

    if (!tableInfo.address) {
      await queryInterface.addColumn('Appointments', 'address', {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Dirección del cliente para servicios a domicilio'
      });
      console.log('✅ Columna address agregada a Appointments');
    } else {
      console.log('ℹ️ Columna address ya existe en Appointments');
    }
  },

  down: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('Appointments');

    if (tableInfo.address) {
      await queryInterface.removeColumn('Appointments', 'address');
      console.log('⬇️ Columna address removida de Appointments');
    }
  }
};
