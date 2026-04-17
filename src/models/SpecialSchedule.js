const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('SpecialSchedule', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    employeeId: { type: DataTypes.UUID, allowNull: true, comment: 'Null = aplica a todos los empleados del negocio' },
    businessId: { type: DataTypes.UUID, allowNull: false },
    specificDate: { type: DataTypes.DATEONLY, allowNull: false, comment: 'Formato YYYY-MM-DD' },
    startTime:  { type: DataTypes.STRING, allowNull: false, comment: 'Formato HH:MM' },
    endTime:    { type: DataTypes.STRING, allowNull: false, comment: 'Formato HH:MM' },
    type:       { 
      type: DataTypes.ENUM('work', 'lunch', 'blocked', 'closed'), 
      defaultValue: 'work', 
      allowNull: false,
      comment: 'work=jornada, lunch=almuerzo, blocked=bloqueado, closed=cerrado (no laborable)' 
    },
    description: { type: DataTypes.STRING, comment: 'Descripcion: Festivo, Dia especial, etc.' },
    isRecurringYearly: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Se repite cada año en la misma fecha (ej: festivos Colombia)' },
    active:     { type: DataTypes.BOOLEAN, defaultValue: true },
  });
};
