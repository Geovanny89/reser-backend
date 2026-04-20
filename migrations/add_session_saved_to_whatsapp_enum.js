module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Agregar el valor 'session_saved' al enum existente
      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_WhatsAppSessions_status" ADD VALUE 'session_saved';
      `);
      console.log('✅ Valor session_saved agregado al enum');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('⚠️ Valor session_saved ya existe en el enum, saltando...');
      } else {
        throw err;
      }
    }
  },

  down: async (queryInterface, Sequelize) => {
    // No se puede eliminar un valor de un enum en PostgreSQL sin recrearlo
    // Esto es un no-op seguro
    console.log('No se puede revertir la adición de valores a enum en PostgreSQL sin recrear la tabla');
  }
};
