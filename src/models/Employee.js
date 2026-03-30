const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Employee', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId:    { type: DataTypes.UUID, allowNull: false },
    userId:        { type: DataTypes.UUID, allowNull: false },
    commissionPct: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0, comment: '% que gana el empleado' },
    ownerPct:      { type: DataTypes.DECIMAL(5, 2), defaultValue: 100, comment: '% que gana el dueño' },
    specialties:   { type: DataTypes.JSON },
    photoUrl:      { type: DataTypes.STRING, comment: 'URL de la foto del empleado' },
    active:        { type: DataTypes.BOOLEAN, defaultValue: true },
  });
};
