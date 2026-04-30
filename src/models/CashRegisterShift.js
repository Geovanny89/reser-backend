const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('CashRegisterShift', {
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
    employeeId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del empleado que abrió la caja'
    },
    openedAt: { 
      type: DataTypes.DATE, 
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Fecha y hora de apertura'
    },
    closedAt: { 
      type: DataTypes.DATE, 
      allowNull: true,
      comment: 'Fecha y hora de cierre'
    },
    openingAmount: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: false,
      defaultValue: 0,
      comment: 'Monto inicial al abrir caja'
    },
    closingAmount: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: true,
      comment: 'Monto real al cerrar caja'
    },
    expectedAmount: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: true,
      comment: 'Monto esperado según movimientos'
    },
    difference: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: true,
      comment: 'Diferencia (faltante/sobrante)'
    },
    status: { 
      type: DataTypes.ENUM('open', 'closed'), 
      defaultValue: 'open',
      allowNull: false,
      comment: 'Estado del turno'
    },
    notes: { 
      type: DataTypes.TEXT, 
      allowNull: true,
      comment: 'Notas del turno'
    },
    createdBy: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del usuario que creó el turno'
    }
  }, {
    tableName: 'cash_register_shifts',
    indexes: [
      {
        unique: false,
        fields: ['businessId']
      },
      {
        unique: false,
        fields: ['employeeId']
      },
      {
        unique: false,
        fields: ['status']
      },
      {
        unique: false,
        fields: ['openedAt']
      },
      {
        unique: false,
        fields: ['businessId', 'status']
      },
      {
        unique: false,
        fields: ['businessId', 'employeeId', 'status']
      }
    ]
  });
};
