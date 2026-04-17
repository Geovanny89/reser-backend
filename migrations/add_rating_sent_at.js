/**
 * Migración: Agregar columna ratingSentAt a appointments
 * Para rastrear cuándo se envió la solicitud de calificación
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.addColumn('Appointments', 'ratingSentAt', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Fecha cuando se envió la solicitud de calificación'
      });
      console.log('✅ Columna ratingSentAt agregada a Appointments');
      
      // Crear índice para mejorar rendimiento de consultas
      await queryInterface.addIndex('Appointments', ['ratingSentAt'], {
        name: 'appointments_rating_sent_at_idx'
      });
      console.log('✅ Índice appointments_rating_sent_at_idx creado');
    } catch (err) {
      console.error('Error en migración:', err.message);
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.removeIndex('Appointments', 'appointments_rating_sent_at_idx');
      await queryInterface.removeColumn('Appointments', 'ratingSentAt');
      console.log('✅ Columna ratingSentAt eliminada de Appointments');
    } catch (err) {
      console.error('Error al revertir migración:', err.message);
      throw err;
    }
  }
};
