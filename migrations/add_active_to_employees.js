'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Verificar si la columna active ya existe
    const tableInfo = await queryInterface.describeTable('Employees');
    
    if (!tableInfo.active) {
      console.log('[Migration] Agregando columna active a Employees...');
      
      // Agregar la columna active
      await queryInterface.addColumn('Employees', 'active', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: true
      });
      
      // Actualizar todos los empleados existentes a active = true
      await queryInterface.sequelize.query(
        `UPDATE "Employees" SET active = true WHERE active IS NULL`
      );
      
      console.log('[Migration] Columna active agregada y empleados actualizados');
    } else {
      console.log('[Migration] La columna active ya existe en Employees');
    }
  },

  async down(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('Employees');
    
    if (tableInfo.active) {
      await queryInterface.removeColumn('Employees', 'active');
      console.log('[Migration] Columna active removida de Employees');
    }
  }
};
