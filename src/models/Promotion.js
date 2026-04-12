const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Promotion', {
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    businessId: { 
      type: DataTypes.UUID, 
      allowNull: false 
    },
    serviceId: { 
      type: DataTypes.UUID, 
      allowNull: true, 
      comment: 'Si es null, aplica a todos los servicios del negocio' 
    },
    name: { 
      type: DataTypes.STRING, 
      allowNull: false 
    },
    description: { 
      type: DataTypes.TEXT 
    },
    discountType: { 
      type: DataTypes.ENUM('percentage', 'fixed'), 
      defaultValue: 'percentage' 
    },
    discountValue: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: false 
    },
    startDate: { 
      type: DataTypes.DATEONLY, 
      allowNull: false 
    },
    endDate: { 
      type: DataTypes.DATEONLY, 
      allowNull: false 
    },
    active: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: true 
    },
    applyToAllServices: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: false 
    }
  });
};
