/**
 * Migration: Agregar campo workEvidences para fotos de evidencia del trabajo
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Función auxiliar para verificar si una columna existe
    const columnExists = async (table, column) => {
      try {
        const tableInfo = await queryInterface.describeTable(table);
        return column in tableInfo;
      } catch (e) {
        return false;
      }
    };

    // Agregar campo workEvidences a Appointments
    if (!(await columnExists('Appointments', 'workEvidences'))) {
      await queryInterface.addColumn('Appointments', 'workEvidences', {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: [],
        comment: 'Fotos de evidencia del trabajo: [{url, description, uploadedAt, uploadedBy}]'
      });
      console.log('✅ Campo workEvidences agregado a Appointments');
    } else {
      console.log('⚠️ Campo workEvidences ya existe, saltando...');
    }

    console.log('\n🎉 Migración completada: Campo workEvidences agregado');
  },

  down: async (queryInterface, Sequelize) => {
    // Remover campo de Appointments
    await queryInterface.removeColumn('Appointments', 'workEvidences');
    
    console.log('⬇️  Campo workEvidences removido');
  }
};
