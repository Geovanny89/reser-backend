module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar si la tabla ya existe
    const tables = await queryInterface.showAllTables();
    
    if (!tables.includes('ScheduledMessages')) {
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
      console.log('✅ Tabla ScheduledMessages creada');
    } else {
      console.log('⚠️ Tabla ScheduledMessages ya existe');
    }

    // Crear índices para búsquedas frecuentes - solo si no existen
    try {
      await queryInterface.addIndex('ScheduledMessages', ['businessId', 'status'], {
        name: 'scheduled_messages_business_id_status'
      });
      console.log('✅ Índice scheduled_messages_business_id_status creado');
    } catch (e) {
      console.log('⚠️ Índice scheduled_messages_business_id_status ya existe');
    }

    try {
      await queryInterface.addIndex('ScheduledMessages', ['scheduledAt'], {
        name: 'scheduled_messages_scheduled_at'
      });
      console.log('✅ Índice scheduled_messages_scheduled_at creado');
    } catch (e) {
      console.log('⚠️ Índice scheduled_messages_scheduled_at ya existe');
    }

    try {
      await queryInterface.addIndex('ScheduledMessages', ['status', 'scheduledAt'], {
        name: 'scheduled_messages_status_scheduled_at'
      });
      console.log('✅ Índice scheduled_messages_status_scheduled_at creado');
    } catch (e) {
      console.log('⚠️ Índice scheduled_messages_status_scheduled_at ya existe');
    }

    try {
      await queryInterface.addIndex('ScheduledMessages', ['appointmentId'], {
        name: 'scheduled_messages_appointment_id'
      });
      console.log('✅ Índice scheduled_messages_appointment_id creado');
    } catch (e) {
      console.log('⚠️ Índice scheduled_messages_appointment_id ya existe');
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('ScheduledMessages');
  }
};
