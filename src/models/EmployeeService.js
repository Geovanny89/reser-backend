const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('EmployeeService', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    employeeId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID del empleado'
    },
    serviceId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID del servicio que puede realizar'
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID del negocio'
    }
  }, {
    tableName: 'EmployeeServices',
    indexes: [
      { fields: ['employeeId', 'serviceId'], unique: true },
      { fields: ['employeeId'] },
      { fields: ['serviceId'] },
      { fields: ['businessId'] }
    ]
  });
};
