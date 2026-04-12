const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Service', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId:  { type: DataTypes.UUID, allowNull: false },
    name:        { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    price:       { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    durationMin: { type: DataTypes.INTEGER, allowNull: false, comment: 'Duración en minutos' },
    active:      { type: DataTypes.BOOLEAN, defaultValue: true },
    // Campos para servicios técnicos
    isTechnicalService: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Es un servicio técnico (sin precio fijo)' },
    priceOptional:      { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'El precio es opcional/cotizable' },
    hasEmployeeCommission: { type: DataTypes.BOOLEAN, defaultValue: true, comment: 'El empleado paga comisión por este servicio' },
    imageUrl: { type: DataTypes.STRING, comment: 'Imagen del servicio' },
  });
};
