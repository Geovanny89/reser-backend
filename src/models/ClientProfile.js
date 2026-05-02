const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('ClientProfile', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    clientPhone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    clientEmail: {
      type: DataTypes.STRING,
      allowNull: true
    },
    birthday: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    lastSentBirthdayYear: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'ClientProfiles',
    indexes: [
      { fields: ['businessId', 'clientPhone'] },
      { fields: ['businessId', 'clientEmail'] }
    ]
  });
};
