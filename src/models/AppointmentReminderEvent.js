/**
 * Modelo de eventos de recordatorio enviados
 * Garantiza idempotencia a nivel de base de datos con UNIQUE constraint
 * Previene duplicados incluso en fallos de proceso o race conditions
 * 
 * Flujo de estados:
 * 1. 'pending' → Insertado pero aún no enviado (permitir reintento)
 * 2. 'sent' → Enviado exitosamente (final)
 * 3. 'failed' → Falló envío, puede reintentarse
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('AppointmentReminderEvent', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    appointmentId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID de la cita relacionada'
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID del negocio que envió el recordatorio'
    },
    reminderType: {
      type: DataTypes.ENUM('24h', '12h', '2h', '1h'),
      allowNull: false,
      comment: 'Tipo de recordatorio enviado'
    },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'failed', 'skipped'),
      allowNull: false,
      defaultValue: 'pending',
      comment: 'Estado del envío: pending (permitir reintento), sent (éxito), failed (reintentar), skipped (baja prioridad descartada)'
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true, // null hasta que se envíe exitosamente
      comment: 'Fecha/hora real de envío (null si está pending o failed)'
    },
    clientPhone: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Teléfono al que se envió (para auditoría)'
    },
    messagePreview: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Primeros 200 caracteres del mensaje enviado (para auditoría)'
    },
    processId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID del proceso/worker que envió el recordatorio'
    },
    retryCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Número de intentos de envío'
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Último error de envío (para debugging)'
    },
    processingBy: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID del worker que está procesando este evento (para detectar zombies)'
    },
    processingAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp cuando el worker comenzó a procesar (para timeout de 2 min)'
    }
  }, {
    tableName: 'AppointmentReminderEvents',
    indexes: [
      // Índice único que garantiza idempotencia: un solo recordatorio por tipo por cita
      {
        unique: true,
        fields: ['appointmentId', 'reminderType'],
        name: 'idx_unique_reminder_per_appointment'
      },
      // Índice para consultas por negocio
      {
        fields: ['businessId', 'sentAt'],
        name: 'idx_business_sent_at'
      },
      // Índice para consultas por cita
      {
        fields: ['appointmentId'],
        name: 'idx_appointment_id'
      },
      // Índice para limpieza automática por fecha
      {
        fields: ['createdAt'],
        name: 'idx_created_at_cleanup'
      },
      // Índice para encontrar pendientes/fallados que necesitan reintento
      {
        fields: ['status', 'createdAt'],
        name: 'idx_status_created_at'
      }
    ]
  });
};
