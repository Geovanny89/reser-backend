const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('SystemSetting', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    key: { type: DataTypes.STRING, unique: true, allowNull: false },
    value: { type: DataTypes.TEXT },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: false }
  });
};
