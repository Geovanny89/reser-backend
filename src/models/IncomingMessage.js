const { DataTypes } = require('sequelize');

/**
 * Modelo para mensajes entrantes de WhatsApp que no se pudieron procesar inmediatamente
 * Se procesan cuando el scheduler se conecta
 */
module.exports = (sequelize) => {
  const IncomingMessage = sequelize.define('IncomingMessage', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID del negocio asociado a la sesión de WhatsApp'
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Teléfono del cliente que envió el mensaje'
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Contenido del mensaje recibido'
    },
    whatsappMessageId: {
      type: DataTypes.STRING,
      comment: 'ID del mensaje en WhatsApp (opcional)'
    },
    status: {
      type: DataTypes.ENUM('pending', 'processed', 'failed'),
      defaultValue: 'pending',
      comment: 'Estado del mensaje: pendiente, procesado, o fallido'
    },
    processedAt: {
      type: DataTypes.DATE,
      comment: 'Cuándo se procesó el mensaje'
    },
    errorMessage: {
      type: DataTypes.TEXT,
      comment: 'Error si falló el procesamiento'
    },
    retryCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Número de intentos de procesamiento'
    }
  }, {
    tableName: 'IncomingMessages',
    timestamps: true
  });

  return IncomingMessage;
};
