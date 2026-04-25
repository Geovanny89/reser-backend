/**
 * Migration: Agregar campos para firma del cliente en servicios a domicilio
 * - clientSignature: Firma en formato base64
 * - clientSignatureName: Nombre del cliente que firmó
 * - clientSignatureDate: Fecha y hora de la firma
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Función auxiliar para verificar si una columna existe
    const columnExists = async (table, column) => {
      try {
        const tableInfo = await queryInterface.describeTable(table);
        return column in tableInfo;
      } catch (e) {
        return false;
      }
    };

    // Agregar campo clientSignature a Appointments
    if (!(await columnExists('Appointments', 'clientSignature'))) {
      await queryInterface.addColumn('Appointments', 'clientSignature', {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Firma del cliente en formato base64 (data:image/png;base64,...)'
      });
      console.log('✅ Campo clientSignature agregado a Appointments');
    } else {
      console.log('⚠️ Campo clientSignature ya existe, saltando...');
    }

    // Agregar campo clientSignatureName a Appointments
    if (!(await columnExists('Appointments', 'clientSignatureName'))) {
      await queryInterface.addColumn('Appointments', 'clientSignatureName', {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Nombre del cliente que firmó'
      });
      console.log('✅ Campo clientSignatureName agregado a Appointments');
    } else {
      console.log('⚠️ Campo clientSignatureName ya existe, saltando...');
    }

    // Agregar campo clientSignatureDate a Appointments
    if (!(await columnExists('Appointments', 'clientSignatureDate'))) {
      await queryInterface.addColumn('Appointments', 'clientSignatureDate', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Fecha y hora cuando se realizó la firma'
      });
      console.log('✅ Campo clientSignatureDate agregado a Appointments');
    } else {
      console.log('⚠️ Campo clientSignatureDate ya existe, saltando...');
    }

    console.log('\n🎉 Migración completada: Campos de firma del cliente agregados');
  },

  down: async (queryInterface, Sequelize) => {
    // Remover campos de Appointments
    await queryInterface.removeColumn('Appointments', 'clientSignatureDate');
    await queryInterface.removeColumn('Appointments', 'clientSignatureName');
    await queryInterface.removeColumn('Appointments', 'clientSignature');
    
    console.log('⬇️  Campos de firma del cliente removidos');
  }
};
