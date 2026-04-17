/**
 * Migración: Agregar campos para mensajes de WhatsApp
 * - reminder12hSent: Recordatorio de 12 horas
 * - referenceMessageSent: Mensaje de referencia
 * - thankYouMessageSent: Mensaje de agradecimiento por calificación
 * - thankYouMessageSentAt: Fecha del mensaje de agradecimiento
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Agregar reminder12hSent
      await queryInterface.addColumn('Appointments', 'reminder12hSent', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Indica si ya se envió recordatorio de 12 horas'
      });
      console.log('✅ Columna reminder12hSent agregada a Appointments');

      // Agregar referenceMessageSent
      await queryInterface.addColumn('Appointments', 'referenceMessageSent', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Indica si ya se envió mensaje de referencia'
      });
      console.log('✅ Columna referenceMessageSent agregada a Appointments');

      // Agregar thankYouMessageSent
      await queryInterface.addColumn('Appointments', 'thankYouMessageSent', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Indica si ya se envió mensaje de agradecimiento por calificación'
      });
      console.log('✅ Columna thankYouMessageSent agregada a Appointments');

      // Agregar thankYouMessageSentAt
      await queryInterface.addColumn('Appointments', 'thankYouMessageSentAt', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Fecha cuando se envió mensaje de agradecimiento'
      });
      console.log('✅ Columna thankYouMessageSentAt agregada a Appointments');

      // Crear índices para mejorar rendimiento
      await queryInterface.addIndex('Appointments', ['reminder12hSent'], {
        name: 'appointments_reminder_12h_idx'
      });
      await queryInterface.addIndex('Appointments', ['referenceMessageSent'], {
        name: 'appointments_reference_msg_idx'
      });
      await queryInterface.addIndex('Appointments', ['thankYouMessageSent'], {
        name: 'appointments_thank_you_idx'
      });
      console.log('✅ Índices creados');

    } catch (err) {
      console.error('Error en migración:', err.message);
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.removeIndex('Appointments', 'appointments_reminder_12h_idx');
      await queryInterface.removeIndex('Appointments', 'appointments_reference_msg_idx');
      await queryInterface.removeIndex('Appointments', 'appointments_thank_you_idx');

      await queryInterface.removeColumn('Appointments', 'thankYouMessageSentAt');
      await queryInterface.removeColumn('Appointments', 'thankYouMessageSent');
      await queryInterface.removeColumn('Appointments', 'referenceMessageSent');
      await queryInterface.removeColumn('Appointments', 'reminder12hSent');

      console.log('✅ Columnas de mensajes eliminadas de Appointments');
    } catch (err) {
      console.error('Error al revertir migración:', err.message);
      throw err;
    }
  }
};
