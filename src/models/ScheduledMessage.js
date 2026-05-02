const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('ScheduledMessage', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID del negocio que envía el mensaje'
    },
    appointmentId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'ID de la cita relacionada (opcional)'
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Número de teléfono destino'
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Contenido del mensaje'
    },
    type: {
      type: DataTypes.ENUM('reminder', 'rating', 'review', 'confirmation', 'cancellation', 'custom', 'queue_fallback', 'birthday'),
      defaultValue: 'custom',
      comment: 'Tipo de mensaje para clasificación'
    },
    scheduledAt: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Fecha/hora programada para envío'
    },
    status: {
      type: DataTypes.ENUM('pending', 'sending', 'sent', 'failed', 'cancelled'),
      defaultValue: 'pending',
      comment: 'Estado del mensaje'
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fecha/hora real de envío'
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Mensaje de error si falló el envío'
    },
    retryCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Número de intentos de reenvío'
    }
  }, {
    tableName: 'ScheduledMessages',
    indexes: [
      { fields: ['businessId', 'status'] },
      { fields: ['scheduledAt'] },
      { fields: ['status', 'scheduledAt'] }
    ]
  });
};
