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
    color: { type: DataTypes.STRING, defaultValue: '#3b82f6', comment: 'Color para identificación visual en calendario (hex)' },
    serviceGroupId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del grupo de servicios al que pertenece'
    },
  }, {
    indexes: [
      { fields: ['businessId'], name: 'idx_service_businessId' },
      { fields: ['businessId', 'active'], name: 'idx_service_businessId_active' },
      { fields: ['serviceGroupId'], name: 'idx_service_serviceGroupId' },
    ]
  });
};
