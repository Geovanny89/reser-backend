/**
 * Migración para limpiar índices duplicados
 * Elimina cientos de índices duplicados que ralentizan las operaciones de escritura
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('Limpiando índices duplicados...');

    // Obtener todos los índices existentes
    const indexes = await queryInterface.showIndex('Users');
    const businessIndexes = await queryInterface.showIndex('Businesses');

    // Índices de Users duplicados (Users_email_key*)
    const duplicateUserIndexes = indexes
      .filter(idx => idx.name.startsWith('Users_email_key') && idx.name !== 'Users_email_key')
      .map(idx => idx.name);

    // Índices de Businesses duplicados (Businesses_slug_key*)
    const duplicateBusinessIndexes = businessIndexes
      .filter(idx => idx.name.startsWith('Businesses_slug_key') && idx.name !== 'Businesses_slug_key')
      .map(idx => idx.name);

    console.log(`Encontrados ${duplicateUserIndexes.length} índices duplicados en Users`);
    console.log(`Encontrados ${duplicateBusinessIndexes.length} índices duplicados en Businesses`);

    // Eliminar índices duplicados de Users
    for (const indexName of duplicateUserIndexes) {
      try {
        await queryInterface.removeIndex('Users', indexName);
        console.log(`✓ Eliminado índice: ${indexName}`);
      } catch (e) {
        console.log(`✗ Error eliminando ${indexName}: ${e.message}`);
      }
    }

    // Eliminar índices duplicados de Businesses
    for (const indexName of duplicateBusinessIndexes) {
      try {
        await queryInterface.removeIndex('Businesses', indexName);
        console.log(`✓ Eliminado índice: ${indexName}`);
      } catch (e) {
        console.log(`✗ Error eliminando ${indexName}: ${e.message}`);
      }
    }

    console.log('Limpieza de índices completada');
  },

  down: async (queryInterface, Sequelize) => {
    // No se puede restaurar índices duplicados
    console.log('No hay rollback para la limpieza de índices duplicados');
  }
};
