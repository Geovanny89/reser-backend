const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PlatformReview = sequelize.define('PlatformReview', {
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
    reviewerName: {
      type: DataTypes.STRING,
      allowNull: false
    },
    businessName: {
      type: DataTypes.STRING,
      allowNull: false
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
      allowNull: false
    },
    isApproved: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    tableName: 'PlatformReviews',
    timestamps: true
  });

  PlatformReview.associate = (models) => {
    PlatformReview.belongsTo(models.Business, { 
      foreignKey: 'businessId', 
      as: 'Business' 
    });
  };

  return PlatformReview;
};
