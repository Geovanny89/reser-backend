/**
 * Migration: Agregar soporte para Técnicos a Domicilio (Seguimiento en Campo)
 * - Campo hasFieldTechnicians en Businesses
 * - Campos de seguimiento en Appointments (technicianStatus, travelStartTime, arrivalTime, serviceStartTime, workReport)
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

    // Agregar campo hasFieldTechnicians a Businesses
    if (!(await columnExists('Businesses', 'hasFieldTechnicians'))) {
      await queryInterface.addColumn('Businesses', 'hasFieldTechnicians', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        comment: 'Indica si envía técnicos a domicilio con seguimiento en tiempo real (deshabilita WhatsApp, menú especial)'
      });
      console.log('✅ Campo hasFieldTechnicians agregado a Businesses');
    } else {
      console.log('⚠️ Campo hasFieldTechnicians ya existe, saltando...');
    }

    // Agregar campos de seguimiento a Appointments
    if (!(await columnExists('Appointments', 'technicianStatus'))) {
      await queryInterface.addColumn('Appointments', 'technicianStatus', {
        type: Sequelize.ENUM('not_started', 'on_the_way', 'arrived', 'in_progress'),
        defaultValue: 'not_started',
        allowNull: false,
        comment: 'Estado del técnico: not_started, on_the_way, arrived, in_progress'
      });
      console.log('✅ Campo technicianStatus agregado a Appointments');
    } else {
      console.log('⚠️ Campo technicianStatus ya existe, saltando...');
    }

    if (!(await columnExists('Appointments', 'travelStartTime'))) {
      await queryInterface.addColumn('Appointments', 'travelStartTime', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Hora cuando el técnico inició el desplazamiento'
      });
      console.log('✅ Campo travelStartTime agregado a Appointments');
    } else {
      console.log('⚠️ Campo travelStartTime ya existe, saltando...');
    }

    if (!(await columnExists('Appointments', 'arrivalTime'))) {
      await queryInterface.addColumn('Appointments', 'arrivalTime', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Hora cuando el técnico llegó al destino'
      });
      console.log('✅ Campo arrivalTime agregado a Appointments');
    } else {
      console.log('⚠️ Campo arrivalTime ya existe, saltando...');
    }

    if (!(await columnExists('Appointments', 'serviceStartTime'))) {
      await queryInterface.addColumn('Appointments', 'serviceStartTime', {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Hora cuando inició el servicio técnico'
      });
      console.log('✅ Campo serviceStartTime agregado a Appointments');
    } else {
      console.log('⚠️ Campo serviceStartTime ya existe, saltando...');
    }

    if (!(await columnExists('Appointments', 'workReport'))) {
      await queryInterface.addColumn('Appointments', 'workReport', {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Reporte del trabajo: diagnosis, solution, recommendations, partsUsed: [{itemId, name, quantity, unit}]'
      });
      console.log('✅ Campo workReport agregado a Appointments');
    } else {
      console.log('⚠️ Campo workReport ya existe, saltando...');
    }

    console.log('\n🎉 Migración completada: Soporte para Técnicos a Domicilio activado');
  },

  down: async (queryInterface, Sequelize) => {
    // Remover campos de Appointments
    await queryInterface.removeColumn('Appointments', 'workReport');
    await queryInterface.removeColumn('Appointments', 'serviceStartTime');
    await queryInterface.removeColumn('Appointments', 'arrivalTime');
    await queryInterface.removeColumn('Appointments', 'travelStartTime');
    await queryInterface.removeColumn('Appointments', 'technicianStatus');
    
    // Remover ENUM de technicianStatus
    await queryInterface.sequelize.query("DROP TYPE IF EXISTS \"enum_Appointments_technicianStatus\";");
    
    // Remover campo de Businesses
    await queryInterface.removeColumn('Businesses', 'hasFieldTechnicians');
    
    console.log('⬇️  Campos de Técnicos a Domicilio removidos');
  }
};
