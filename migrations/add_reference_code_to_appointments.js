/**
 * Migración: Agregar columna referenceCode a appointments
 * Código único de 6 caracteres para referencia en WhatsApp
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Agregar columna referenceCode
      await queryInterface.addColumn('Appointments', 'referenceCode', {
        type: Sequelize.STRING(8),
        allowNull: true,
        unique: true,
        comment: 'Código único de 6 caracteres para referencia en WhatsApp (ej: ABC123)'
      });
      console.log('✅ Columna referenceCode agregada a Appointments');

      // Crear índice único
      await queryInterface.addIndex('Appointments', ['referenceCode'], {
        name: 'appointments_reference_code_idx',
        unique: true
      });
      console.log('✅ Índice appointments_reference_code_idx creado');

    } catch (err) {
      console.error('Error en migración:', err.message);
      throw err;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.removeIndex('Appointments', 'appointments_reference_code_idx');
      await queryInterface.removeColumn('Appointments', 'referenceCode');
      console.log('✅ Columna referenceCode eliminada de Appointments');
    } catch (err) {
      console.error('Error al revertir migración:', err.message);
      throw err;
    }
  }
};
