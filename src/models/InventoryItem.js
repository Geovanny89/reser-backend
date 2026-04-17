const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('InventoryItem', {
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
    name: { 
      type: DataTypes.STRING, 
      allowNull: false,
      comment: 'Nombre del insumo'
    },
    description: { 
      type: DataTypes.TEXT, 
      allowNull: true,
      comment: 'Descripción del insumo'
    },
    unit: { 
      type: DataTypes.STRING, 
      allowNull: false,
      defaultValue: 'unidad',
      comment: 'Unidad de medida: unidad, gramos, mililitros, metros, etc.'
    },
    currentStock: { 
      type: DataTypes.DECIMAL(10, 2), 
      defaultValue: 0,
      comment: 'Stock actual disponible'
    },
    minStock: { 
      type: DataTypes.DECIMAL(10, 2), 
      defaultValue: 0,
      comment: 'Stock mínimo para alerta'
    },
    costPerUnit: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: true,
      comment: 'Costo por unidad (para cálculo de gastos)'
    },
    supplier: { 
      type: DataTypes.STRING, 
      allowNull: true,
      comment: 'Proveedor del insumo'
    },
    active: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: true 
    }
  });
};
