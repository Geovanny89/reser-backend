const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CashMovement', {
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
    shiftId: { 
      type: DataTypes.UUID, 
      allowNull: false,
      comment: 'ID del turno de caja'
    },
    appointmentId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID de la cita asociada (si aplica)'
    },
    expenseId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del gasto asociado (si aplica)'
    },
    type: { 
      type: DataTypes.ENUM('income', 'expense', 'withdrawal'), 
      allowNull: false,
      comment: 'Tipo de movimiento: income (ingreso), expense (gasto), withdrawal (retiro)'
    },
    amount: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: false,
      comment: 'Monto del movimiento'
    },
    paymentMethod: { 
      type: DataTypes.ENUM('cash', 'card', 'transfer', 'nequi', 'daviplata'), 
      allowNull: false,
      defaultValue: 'cash',
      comment: 'Método de pago'
    },
    suppliesCost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Costo de insumos asociados a este movimiento (informativo)'
    },
    description: { 
      type: DataTypes.STRING, 
      allowNull: false,
      comment: 'Descripción del movimiento'
    },
    notes: { 
      type: DataTypes.TEXT, 
      allowNull: true,
      comment: 'Notas adicionales'
    },
    isReversal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Indica si este movimiento es una reversa generada por corrección'
    },
    reversesMovementId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'ID del movimiento original que este registro revierte (si aplica)'
    },
    createdAt: { 
      type: DataTypes.DATE, 
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Fecha y hora del movimiento'
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'general',
      comment: 'Categoría del movimiento (general, supplies, withdrawal, salary, etc.)'
    },
    createdBy: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del usuario que registró el movimiento'
    }
  }, {
    tableName: 'cash_movements',
    indexes: [
      {
        unique: false,
        fields: ['businessId']
      },
      {
        unique: false,
        fields: ['shiftId']
      },
      {
        unique: false,
        fields: ['appointmentId']
      },
      {
        unique: false,
        fields: ['expenseId']
      },
      {
        unique: false,
        fields: ['type']
      },
      {
        unique: false,
        fields: ['paymentMethod']
      },
      {
        unique: false,
        fields: ['createdAt']
      },
      {
        unique: false,
        fields: ['businessId', 'shiftId']
      },
      {
        unique: false,
        fields: ['businessId', 'createdAt']
      },
      {
        unique: false,
        fields: ['shiftId', 'createdAt']
      },
      {
        unique: false,
        fields: ['isReversal']
      },
      {
        unique: false,
        fields: ['reversesMovementId']
      }
    ]
  });
};
