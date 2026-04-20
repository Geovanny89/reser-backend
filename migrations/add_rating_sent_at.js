/**
 * Migración: Agregar columna ratingSentAt a appointments
 * Para rastrear cuándo se envió la solicitud de calificación
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Verificar si la columna ya existe
      const tableInfo = await queryInterface.describeTable('Appointments');
      
      if (!tableInfo.ratingSentAt) {
        await queryInterface.addColumn('Appointments', 'ratingSentAt', {
          type: Sequelize.DATE,
          allowNull: true,
          comment: 'Fecha cuando se envió la solicitud de calificación'
        }, { transaction });
        console.log('✅ Columna ratingSentAt agregada a Appointments');
      } else {
        console.log('⚠️ Columna ratingSentAt ya existe, saltando...');
      }
      
      // Crear índice si no existe
      try {
        await queryInterface.addIndex('Appointments', ['ratingSentAt'], {
          name: 'appointments_rating_sent_at_idx'
        }, { transaction });
        console.log('✅ Índice appointments_rating_sent_at_idx creado');
      } catch (idxErr) {
        console.log('⚠️ Índice appointments_rating_sent_at_idx ya existe, saltando...');
      }
      
      await transaction.commit();
      console.log('🎉 Migración ratingSentAt completada');
    } catch (err) {
      await transaction.rollback();
      console.error('❌ Error en migración:', err.message);
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
