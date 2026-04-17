const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Deposit', {
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
    appointmentId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID de la cita asociada (si aplica)'
    },
    clientName: { 
      type: DataTypes.STRING, 
      allowNull: false,
      comment: 'Nombre del cliente'
    },
    clientPhone: { 
      type: DataTypes.STRING, 
      allowNull: true,
      comment: 'Teléfono del cliente'
    },
    amount: { 
      type: DataTypes.DECIMAL(10, 2), 
      allowNull: false,
      comment: 'Monto del anticipo/deposito'
    },
    date: { 
      type: DataTypes.DATEONLY, 
      allowNull: false,
      comment: 'Fecha del deposito'
    },
    paymentMethod: { 
      type: DataTypes.ENUM('cash', 'transfer', 'nequi', 'daviplata'), 
      defaultValue: 'cash',
      comment: 'Método de pago del anticipo'
    },
    status: { 
      type: DataTypes.ENUM('held', 'applied', 'refunded', 'forfeited'), 
      defaultValue: 'held',
      comment: 'Estado: retenido, aplicado, reembolsado, perdido'
    },
    notes: { 
      type: DataTypes.TEXT, 
      allowNull: true,
      comment: 'Notas adicionales'
    },
    receiptUrl: { 
      type: DataTypes.STRING, 
      allowNull: true,
      comment: 'Comprobante del deposito'
    },
    createdBy: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del usuario que registró'
    }
  });
};
