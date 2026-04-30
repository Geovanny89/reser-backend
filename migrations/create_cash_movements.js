module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('cash_movements', {
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
      shiftId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'cash_register_shifts',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Appointments',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      expenseId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Expenses',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      type: {
        type: Sequelize.ENUM('income', 'expense', 'withdrawal'),
        allowNull: false
      },
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      paymentMethod: {
        type: Sequelize.ENUM('cash', 'card', 'transfer', 'nequi', 'daviplata'),
        defaultValue: 'cash',
        allowNull: false
      },
      description: {
        type: Sequelize.STRING,
        allowNull: false
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      createdBy: {
        type: Sequelize.UUID,
        allowNull: true
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Índices para optimización
    await queryInterface.addIndex('cash_movements', ['businessId']);
    await queryInterface.addIndex('cash_movements', ['shiftId']);
    await queryInterface.addIndex('cash_movements', ['appointmentId']);
    await queryInterface.addIndex('cash_movements', ['expenseId']);
    await queryInterface.addIndex('cash_movements', ['type']);
    await queryInterface.addIndex('cash_movements', ['paymentMethod']);
    await queryInterface.addIndex('cash_movements', ['createdAt']);
    await queryInterface.addIndex('cash_movements', ['businessId', 'shiftId']);
    await queryInterface.addIndex('cash_movements', ['businessId', 'createdAt']);
    await queryInterface.addIndex('cash_movements', ['shiftId', 'createdAt']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('cash_movements');
  }
};
