/**
 * Migration: Agregar campo isTechnicalServices a Businesses
 * - Indica si es negocio de servicios técnicos (genera OS en lugar de recibo)
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Función auxiliar para verificar si una columna existe
    const columnExists = async (table, column) => {
      try {
        const result = await queryInterface.sequelize.query(
          `SELECT column_name 
           FROM information_schema.columns 
           WHERE table_name = '${table}' AND column_name = '${column}'`
        );
        return result[0].length > 0;
      } catch (error) {
        console.log(`Error verificando columna ${column}:`, error.message);
        return false;
      }
    };

    // Agregar campo isTechnicalServices a Businesses
    if (!(await columnExists('Businesses', 'isTechnicalServices'))) {
      await queryInterface.addColumn('Businesses', 'isTechnicalServices', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        comment: 'Indica si es negocio de servicios técnicos (genera OS en lugar de recibo)'
      });
      console.log('✅ Campo isTechnicalServices agregado a Businesses');
    } else {
      console.log('⚠️ Campo isTechnicalServices ya existe, saltando...');
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Remover campo de Businesses
    await queryInterface.removeColumn('Businesses', 'isTechnicalServices');
    console.log('⬇️ Campo isTechnicalServices removido de Businesses');
  }
};
