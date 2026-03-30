const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Schedule', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    employeeId: { type: DataTypes.UUID, allowNull: false },
    businessId: { type: DataTypes.UUID, allowNull: false },
    dayOfWeek:  { type: DataTypes.INTEGER, allowNull: false, comment: '0=Dom, 1=Lun, ..., 6=Sab' },
    startTime:  { type: DataTypes.STRING, allowNull: false, comment: 'Formato HH:MM' },
    endTime:    { type: DataTypes.STRING, allowNull: false, comment: 'Formato HH:MM' },
    type:       { 
      type: DataTypes.ENUM('work', 'lunch', 'blocked'), 
      defaultValue: 'work', 
      allowNull: false,
      comment: 'work=jornada, lunch=almuerzo, blocked=bloqueado' 
    },
    description: { type: DataTypes.STRING, comment: 'Descripcion del bloqueo o evento' },
    active:     { type: DataTypes.BOOLEAN, defaultValue: true },
  });
};
