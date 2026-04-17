module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Agregar el valor 'session_saved' al enum existente
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_WhatsAppSessions_status" ADD VALUE 'session_saved';
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // No se puede eliminar un valor de un enum en PostgreSQL sin recrearlo
    // Esto es un no-op seguro
    console.log('No se puede revertir la adición de valores a enum en PostgreSQL sin recrear la tabla');
  }
};
