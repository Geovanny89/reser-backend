const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const BusinessReview = sequelize.define('BusinessReview', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'Businesses',
        key: 'id'
      }
    },
    clientName: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Cliente Anónimo'
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isApproved: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'BusinessReviews',
    timestamps: true,
    indexes: [
      { fields: ['businessId'] },
      { fields: ['isApproved'] },
      { fields: ['createdAt'] }
    ]
  });

  BusinessReview.associate = (models) => {
    BusinessReview.belongsTo(models.Business, { 
      foreignKey: 'businessId', 
      as: 'Business' 
    });
  };

  return BusinessReview;
};
