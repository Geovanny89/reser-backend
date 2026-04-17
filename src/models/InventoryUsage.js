const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('InventoryUsage', {
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    businessId: { 
      type: DataTypes.UUID, 
      allowNull: false,
      comment: 'ID del negocio'
    },
    itemId: { 
      type: DataTypes.UUID, 
      allowNull: false,
      comment: 'ID del insumo usado'
    },
    appointmentId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID de la cita asociada (opcional)'
    },
    quantity: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: false,
      comment: 'Cantidad usada'
    },
    date: { 
      type: DataTypes.DATEONLY, 
      allowNull: false,
      comment: 'Fecha de uso'
    },
    notes: { 
      type: DataTypes.TEXT, 
      allowNull: true,
      comment: 'Notas sobre el uso'
    },
    usedBy: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del empleado que usó el insumo'
    }
  });
};
