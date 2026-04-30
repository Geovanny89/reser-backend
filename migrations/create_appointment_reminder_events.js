/**
 * Migración: Tabla de eventos de recordatorio enviados
 * Garantiza idempotencia a nivel de base de datos
 * 
 * UNIQUE constraint en (appointmentId, reminderType) previene duplicados
 * incluso en escenarios de race condition o fallo de proceso
 * 
 * Campo status permite flujo:
 * - 'pending': insertado pero no enviado (permite reintento)
 * - 'sent': enviado exitosamente
 * - 'failed': falló envío (permite reintento)
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;

    await queryInterface.createTable('AppointmentReminderEvents', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      appointmentId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'Appointments',
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
      reminderType: {
        type: DataTypes.ENUM('24h', '12h', '2h', '1h'),
        allowNull: false
      },
      status: {
        type: DataTypes.ENUM('pending', 'sent', 'failed', 'skipped'),
        allowNull: false,
        defaultValue: 'pending'
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true // null hasta que se envíe exitosamente
      },
      clientPhone: {
        type: DataTypes.STRING,
        allowNull: true
      },
      messagePreview: {
        type: DataTypes.STRING(200),
        allowNull: true
      },
      processId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      retryCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      lastError: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      processingBy: {
        type: DataTypes.STRING,
        allowNull: true
      },
      processingAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Índice único que garantiza idempotencia: un solo recordatorio por tipo por cita
    await queryInterface.addIndex('AppointmentReminderEvents', {
      fields: ['appointmentId', 'reminderType'],
      unique: true,
      name: 'idx_unique_reminder_per_appointment'
    });

    // Índice para consultas por negocio
    await queryInterface.addIndex('AppointmentReminderEvents', {
      fields: ['businessId', 'sentAt'],
      name: 'idx_business_sent_at'
    });

    // Índice para consultas por cita
    await queryInterface.addIndex('AppointmentReminderEvents', {
      fields: ['appointmentId'],
      name: 'idx_appointment_id'
    });

    // Índice para limpieza automática por fecha
    await queryInterface.addIndex('AppointmentReminderEvents', {
      fields: ['createdAt'],
      name: 'idx_created_at_cleanup'
    });

    // Índice para encontrar pendientes/fallados que necesitan reintento
    await queryInterface.addIndex('AppointmentReminderEvents', {
      fields: ['status', 'createdAt'],
      name: 'idx_status_created_at'
    });

    console.log('✅ Tabla AppointmentReminderEvents creada con UNIQUE constraint y estados para idempotencia');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('AppointmentReminderEvents');
  }
};
