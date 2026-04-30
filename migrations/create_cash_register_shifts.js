module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('cash_register_shifts', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      businessId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Businesses',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      employeeId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Employees',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      openedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      closedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      openingAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
      },
      closingAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      expectedAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      difference: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('open', 'closed'),
        defaultValue: 'open',
        allowNull: false
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      createdBy: {
        type: Sequelize.UUID,
        allowNull: true
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

    // Índices para optimización
    await queryInterface.addIndex('cash_register_shifts', ['businessId']);
    await queryInterface.addIndex('cash_register_shifts', ['employeeId']);
    await queryInterface.addIndex('cash_register_shifts', ['status']);
    await queryInterface.addIndex('cash_register_shifts', ['openedAt']);
    await queryInterface.addIndex('cash_register_shifts', ['businessId', 'status']);
    await queryInterface.addIndex('cash_register_shifts', ['businessId', 'employeeId', 'status']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('cash_register_shifts');
  }
};
