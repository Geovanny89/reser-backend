/**
 * Migración: Agregar columna referenceCode a appointments
 * Código único de 6 caracteres para referencia en WhatsApp
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // Verificar si la columna ya existe
      const tableInfo = await queryInterface.describeTable('Appointments');
      
      // Agregar columna referenceCode si no existe
      if (!tableInfo.referenceCode) {
        await queryInterface.addColumn('Appointments', 'referenceCode', {
          type: Sequelize.STRING(8),
          allowNull: true,
          unique: true,
          comment: 'Código único de 6 caracteres para referencia en WhatsApp (ej: ABC123)'
        }, { transaction });
        console.log('✅ Columna referenceCode agregada a Appointments');
      } else {
        console.log('⚠️ Columna referenceCode ya existe, saltando...');
      }

      // Crear índice si no existe
      try {
        await queryInterface.addIndex('Appointments', ['referenceCode'], {
          name: 'appointments_reference_code_idx',
          unique: true
        }, { transaction });
        console.log('✅ Índice appointments_reference_code_idx creado');
      } catch (idxErr) {
        console.log('⚠️ Índice appointments_reference_code_idx ya existe, saltando...');
      }
      
      await transaction.commit();
      console.log('🎉 Migración referenceCode completada');

    } catch (err) {
      await transaction.rollback();
      console.error('❌ Error en migración:', err.message);
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
