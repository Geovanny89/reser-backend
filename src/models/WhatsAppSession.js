const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('WhatsAppSession', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId: { type: DataTypes.UUID, allowNull: false, unique: true },
    sessionData: { type: DataTypes.TEXT, comment: 'Datos de la sesión de Baileys serializados' },
    status: { type: DataTypes.ENUM('disconnected', 'connecting', 'connected'), defaultValue: 'disconnected' },
    phoneNumber: { type: DataTypes.STRING },
  });
};
