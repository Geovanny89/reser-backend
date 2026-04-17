const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Expense', {
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
    category: { 
      type: DataTypes.STRING, 
      allowNull: false,
      comment: 'Categoría del gasto: arriendo, servicios, insumos, nomina, otros'
    },
    description: { 
      type: DataTypes.STRING, 
      allowNull: false,
      comment: 'Descripción del gasto'
    },
    amount: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: false,
      comment: 'Monto del gasto'
    },
    date: { 
      type: DataTypes.DATEONLY, 
      allowNull: false,
      comment: 'Fecha del gasto'
    },
    paymentMethod: { 
      type: DataTypes.ENUM('cash', 'transfer', 'card', 'other'), 
      defaultValue: 'cash',
      comment: 'Método de pago'
    },
    receiptUrl: { 
      type: DataTypes.STRING, 
      allowNull: true,
      comment: 'URL del comprobante/soporte'
    },
    notes: { 
      type: DataTypes.TEXT, 
      allowNull: true,
      comment: 'Notas adicionales'
    },
    createdBy: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del usuario que registró el gasto'
    }
  });
};
