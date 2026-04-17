const { DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('SpecialSchedules', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      employeeId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'Employees',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
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
      specificDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        comment: 'Formato YYYY-MM-DD'
      },
      startTime: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Formato HH:MM'
      },
      endTime: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Formato HH:MM'
      },
      type: {
        type: DataTypes.ENUM('work', 'lunch', 'blocked', 'closed'),
        defaultValue: 'work',
        allowNull: false,
        comment: 'work=jornada, lunch=almuerzo, blocked=bloqueado, closed=cerrado'
      },
      description: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Descripcion: Festivo, Dia especial, etc.'
      },
      isRecurringYearly: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Se repite cada año en la misma fecha (ej: festivos Colombia)'
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
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

    // Índices para búsquedas eficientes
    await queryInterface.addIndex('SpecialSchedules', ['businessId', 'specificDate', 'active'], {
      name: 'idx_special_schedules_business_date_active'
    });
    
    await queryInterface.addIndex('SpecialSchedules', ['employeeId', 'specificDate', 'active'], {
      name: 'idx_special_schedules_employee_date_active'
    });
    
    await queryInterface.addIndex('SpecialSchedules', ['isRecurringYearly', 'active'], {
      name: 'idx_special_schedules_recurring_active'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('SpecialSchedules');
  }
};
