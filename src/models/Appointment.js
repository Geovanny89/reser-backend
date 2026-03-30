const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Appointment', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId:  { type: DataTypes.UUID, allowNull: false },
    serviceId:   { type: DataTypes.UUID, allowNull: false },
    employeeId:  { type: DataTypes.UUID, allowNull: false },
    clientId:    { type: DataTypes.UUID },
    clientName:  { type: DataTypes.STRING },
    clientPhone: { type: DataTypes.STRING },
    clientEmail: { type: DataTypes.STRING, comment: 'Email del cliente no registrado para notificaciones' },
    startTime:   { type: DataTypes.DATE, allowNull: false },
    endTime:     { type: DataTypes.DATE, allowNull: false },
    status:      { type: DataTypes.ENUM('pending', 'confirmed', 'attention', 'done', 'cancelled'), defaultValue: 'pending' },
    notes:       { type: DataTypes.TEXT },
    reminderSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió el recordatorio de 1 hora' },
  });
};
