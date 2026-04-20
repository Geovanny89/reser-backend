/**
 * Migration: Add description column to EmployeeVacations
 * La columna description existe en el modelo pero no en la base de datos
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('EmployeeVacations', 'description', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Descripción opcional (ej: Vacaciones de verano)'
    });
    console.log('✅ Columna "description" agregada a EmployeeVacations');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('EmployeeVacations', 'description');
    console.log('⏪ Columna "description" removida de EmployeeVacations');
  }
};
