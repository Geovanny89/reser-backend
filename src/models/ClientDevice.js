const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('ClientDevice', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email:     { type: DataTypes.STRING, allowNull: false, unique: true },
    pushToken: { type: DataTypes.STRING, allowNull: false },
    lastLogin: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  });
};
