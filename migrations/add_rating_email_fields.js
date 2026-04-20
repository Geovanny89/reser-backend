/**
 * Migración: Agregar campos para tracking de calificación por email
 * - ratingEmailSent: Boolean que indica si ya se envió el email de calificación
 * - ratingEmailSentAt: Fecha cuando se envió el email de calificación
 * - ratingSubmittedAt: Fecha cuando el cliente envió la calificación
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Obtener información de columnas existentes
      const tableInfo = await queryInterface.describeTable('Appointments');

      // Agregar columna ratingEmailSent si no existe
      if (!tableInfo.ratingEmailSent) {
        await queryInterface.addColumn('Appointments', 'ratingEmailSent', {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
          allowNull: false,
          comment: 'Indica si ya se envió el email de solicitud de calificación'
        }, { transaction });
        console.log('✅ Columna ratingEmailSent agregada a Appointments');
      } else {
        console.log('⚠️ Columna ratingEmailSent ya existe, saltando...');
      }

      // Agregar columna ratingEmailSentAt si no existe
      if (!tableInfo.ratingEmailSentAt) {
        await queryInterface.addColumn('Appointments', 'ratingEmailSentAt', {
          type: Sequelize.DATE,
          allowNull: true,
          comment: 'Fecha cuando se envió el email de solicitud de calificación'
        }, { transaction });
        console.log('✅ Columna ratingEmailSentAt agregada a Appointments');
      } else {
        console.log('⚠️ Columna ratingEmailSentAt ya existe, saltando...');
      }

      // Agregar columna ratingSubmittedAt si no existe
      if (!tableInfo.ratingSubmittedAt) {
        await queryInterface.addColumn('Appointments', 'ratingSubmittedAt', {
          type: Sequelize.DATE,
          allowNull: true,
          comment: 'Fecha cuando el cliente envió la calificación'
        }, { transaction });
        console.log('✅ Columna ratingSubmittedAt agregada a Appointments');
      } else {
        console.log('⚠️ Columna ratingSubmittedAt ya existe, saltando...');
      }

      // Crear índice si no existe
      try {
        await queryInterface.addIndex('Appointments', ['ratingEmailSent'], {
          name: 'appointments_rating_email_sent_idx'
        }, { transaction });
        console.log('✅ Índice appointments_rating_email_sent_idx creado');
      } catch (idxErr) {
        console.log('⚠️ Índice appointments_rating_email_sent_idx ya existe o no se pudo crear, saltando...');
      }

      await transaction.commit();
      console.log('🎉 Migración completada: Campos de rating email activados');

    } catch (err) {
      await transaction.rollback();
      console.error('❌ Error en migración:', err.message);
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.removeIndex('Appointments', 'appointments_rating_email_sent_idx');
      await queryInterface.removeColumn('Appointments', 'ratingSubmittedAt');
      await queryInterface.removeColumn('Appointments', 'ratingEmailSentAt');
      await queryInterface.removeColumn('Appointments', 'ratingEmailSent');
      console.log('✅ Columnas de rating email eliminadas de Appointments');
    } catch (err) {
      console.error('Error al revertir migración:', err.message);
      throw err;
    }
  }
};
