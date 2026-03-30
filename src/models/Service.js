const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Service', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId:  { type: DataTypes.UUID, allowNull: false },
    name:        { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT },
    price:       { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    durationMin: { type: DataTypes.INTEGER, allowNull: false, comment: 'Duración en minutos' },
    active:      { type: DataTypes.BOOLEAN, defaultValue: true },
  });
};
