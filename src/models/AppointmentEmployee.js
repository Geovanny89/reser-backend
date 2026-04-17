const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('AppointmentEmployee', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    appointmentId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID de la cita'
    },
    employeeId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID del empleado asignado a esta cita'
    },
    role: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Rol del empleado en esta cita (ej: principal, auxiliar)'
    }
  }, {
    tableName: 'AppointmentEmployees',
    indexes: [
      {
        unique: true,
        fields: ['appointmentId', 'employeeId']
      },
      {
        fields: ['employeeId']
      }
    ]
  });
};
