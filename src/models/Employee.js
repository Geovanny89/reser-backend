const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Employee', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId:    { type: DataTypes.UUID, allowNull: false },
    userId:        { type: DataTypes.UUID, allowNull: false },
    commissionPct: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0, comment: '% que gana el empleado' },
    ownerPct:      { type: DataTypes.DECIMAL(5, 2), defaultValue: 100, comment: '% que gana el dueño' },
    specialties:   { type: DataTypes.JSON },
    specialty:     { type: DataTypes.STRING, comment: 'Título o cargo (ej: Manicurista, Barbero)' },
    photoUrl:      { type: DataTypes.STRING, comment: 'URL de la foto del empleado' },
    description:   { type: DataTypes.TEXT, comment: 'Perfil o descripción profesional del empleado' },
    active:        { type: DataTypes.BOOLEAN, defaultValue: true },
    isManager:     { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si puede gestionar el negocio como administrador' },
    // Campos de calificación del empleado
   
  }, {
    indexes: [
      { fields: ['businessId'], name: 'idx_employee_businessId' },
      { fields: ['businessId', 'active'], name: 'idx_employee_businessId_active' },
      { fields: ['userId'], name: 'idx_employee_userId' },
    ]
  });
};
