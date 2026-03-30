const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BusinessType = sequelize.define('BusinessType', {
    id:     { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    value:  { type: DataTypes.STRING, allowNull: false, unique: true },
    label:  { type: DataTypes.STRING, allowNull: false },
    icon:   { type: DataTypes.STRING, defaultValue: '🏪' },
    active: { type: DataTypes.BOOLEAN, defaultValue: true },
    order:  { type: DataTypes.INTEGER, defaultValue: 0 },
  });
  return BusinessType;
};
