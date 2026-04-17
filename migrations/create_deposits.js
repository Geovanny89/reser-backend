module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('Deposits', {
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
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Appointments',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      clientName: {
        type: Sequelize.STRING,
        allowNull: false
      },
      clientPhone: {
        type: Sequelize.STRING,
        allowNull: true
      },
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      paymentMethod: {
        type: Sequelize.ENUM('cash', 'transfer', 'nequi', 'daviplata'),
        defaultValue: 'cash'
      },
      status: {
        type: Sequelize.ENUM('held', 'applied', 'refunded', 'forfeited'),
        defaultValue: 'held'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      receiptUrl: {
        type: Sequelize.STRING,
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

    await queryInterface.addIndex('Deposits', ['businessId']);
    await queryInterface.addIndex('Deposits', ['appointmentId']);
    await queryInterface.addIndex('Deposits', ['clientPhone']);
    await queryInterface.addIndex('Deposits', ['status']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('Deposits');
  }
};
