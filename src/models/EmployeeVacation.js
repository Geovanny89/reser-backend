const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('EmployeeVacation', {
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    employeeId: { 
      type: DataTypes.UUID, 
      allowNull: false,
      comment: 'ID del empleado que tomará vacaciones'
    },
    businessId: { 
      type: DataTypes.UUID, 
      allowNull: false,
      comment: 'ID del negocio'
    },
    startDate: { 
      type: DataTypes.DATEONLY, 
      allowNull: false,
      comment: 'Fecha de inicio de vacaciones (YYYY-MM-DD)'
    },
    endDate: { 
      type: DataTypes.DATEONLY, 
      allowNull: false,
      comment: 'Fecha de fin de vacaciones (YYYY-MM-DD)'
    },
    description: { 
      type: DataTypes.STRING, 
      allowNull: true,
      comment: 'Descripción opcional (ej: Vacaciones de verano)'
    },
    active: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: true,
      comment: 'Indica si el período de vacaciones está activo'
    }
  }, {
    tableName: 'EmployeeVacations',
    timestamps: true,
    indexes: [
      {
        fields: ['employeeId', 'active']
      },
      {
        fields: ['businessId', 'active']
      },
      {
        fields: ['startDate', 'endDate']
      }
    ]
  });
};
