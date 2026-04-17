module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ScheduledMessages', {
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
      phone: {
        type: Sequelize.STRING,
        allowNull: false
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      type: {
        type: Sequelize.ENUM('reminder', 'rating', 'review', 'confirmation', 'cancellation', 'custom', 'queue_fallback', 'thank_you'),
        defaultValue: 'custom',
        allowNull: false
      },
      scheduledAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      status: {
        type: Sequelize.ENUM('pending', 'sending', 'sent', 'failed', 'cancelled'),
        defaultValue: 'pending',
        allowNull: false
      },
      sentAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      retryCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
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

    // Crear índices para búsquedas frecuentes
    await queryInterface.addIndex('ScheduledMessages', ['businessId', 'status']);
    await queryInterface.addIndex('ScheduledMessages', ['scheduledAt']);
    await queryInterface.addIndex('ScheduledMessages', ['status', 'scheduledAt']);
    await queryInterface.addIndex('ScheduledMessages', ['appointmentId']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('ScheduledMessages');
  }
};
