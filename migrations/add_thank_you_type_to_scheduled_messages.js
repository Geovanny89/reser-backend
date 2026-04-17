/**
 * Migración: Agregar 'thank_you' al ENUM de tipos de mensaje programado
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Para PostgreSQL, necesitamos agregar el valor al ENUM existente
      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_ScheduledMessages_type" ADD VALUE 'thank_you';
      `);
      console.log('✅ Valor thank_you agregado al ENUM de ScheduledMessages');
    } catch (err) {
      // Si el valor ya existe o hay otro error, lo ignoramos
      if (err.message.includes('already exists')) {
        console.log('ℹ️ El valor thank_you ya existe en el ENUM');
      } else {
        console.error('Error en migración:', err.message);
        throw err;
      }
    }
  },

  down: async (queryInterface, Sequelize) => {
    // PostgreSQL no permite eliminar valores de ENUM fácilmente
    // Se requiere recrear el ENUM completo, lo cual es riesgoso
    console.log('⚠️ No se puede revertir la eliminación de un valor ENUM en PostgreSQL sin recrear la columna');
  }
};
