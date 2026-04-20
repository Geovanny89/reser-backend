/**
 * Migration: Crear tabla AppointmentEmployees para citas grupales
 * Permite asignar múltiples empleados a una misma cita
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar si la tabla ya existe
    const tables = await queryInterface.showAllTables();
    if (tables.includes('AppointmentEmployees')) {
      console.log('⚠️ Tabla AppointmentEmployees ya existe, saltando...');
      return;
    }
    
    await queryInterface.createTable('AppointmentEmployees', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Appointments',
          key: 'id'
        },
        onDelete: 'CASCADE',
        comment: 'ID de la cita'
      },
      employeeId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Employees',
          key: 'id'
        },
        onDelete: 'CASCADE',
        comment: 'ID del empleado asignado'
      },
      role: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Rol del empleado en esta cita (ej: principal, auxiliar)'
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Índice único para evitar duplicados
    await queryInterface.addIndex('AppointmentEmployees', ['appointmentId', 'employeeId'], {
      unique: true,
      name: 'idx_appointment_employee_unique'
    });

    // Índice para búsquedas por empleado
    await queryInterface.addIndex('AppointmentEmployees', ['employeeId'], {
      name: 'idx_appointment_employee_employeeid'
    });

    console.log('✅ Tabla AppointmentEmployees creada');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('AppointmentEmployees');
    console.log('⬇️  Tabla AppointmentEmployees eliminada');
  }
};
