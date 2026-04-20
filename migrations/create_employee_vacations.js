/**
 * Migración: Crear tabla de vacaciones de empleados
 * 
 * Esta tabla permite gestionar períodos de vacaciones por empleado
 * con fecha de inicio y fin. Durante estos períodos el empleado
 * no aparecerá disponible en la agenda.
 */

const { DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar si la tabla ya existe
    const tables = await queryInterface.showAllTables();
    if (tables.includes('EmployeeVacations')) {
      console.log('⚠️ Tabla EmployeeVacations ya existe, saltando...');
      return;
    }
    
    await queryInterface.createTable('EmployeeVacations', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      employeeId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'Employees',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      businessId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'Businesses',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: 'Fecha de inicio de vacaciones (YYYY-MM-DD)'
      },
      endDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: 'Fecha de fin de vacaciones (YYYY-MM-DD)'
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Descripción opcional (ej: Vacaciones de verano)'
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: 'Indica si el período de vacaciones está activo'
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // Crear índices para optimizar búsquedas
    await queryInterface.addIndex('EmployeeVacations', ['employeeId', 'active'], {
      name: 'employee_vacations_employee_active_idx'
    });
    
    await queryInterface.addIndex('EmployeeVacations', ['businessId', 'active'], {
      name: 'employee_vacations_business_active_idx'
    });
    
    await queryInterface.addIndex('EmployeeVacations', ['startDate', 'endDate'], {
      name: 'employee_vacations_dates_idx'
    });

    console.log('✅ Tabla EmployeeVacations creada exitosamente');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('EmployeeVacations');
    console.log('⬇️  Tabla EmployeeVacations eliminada');
  }
};
