const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('ActivityLog', {
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    userId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      references: { model: 'Users', key: 'id' }
    },
    userEmail: { 
      type: DataTypes.STRING, 
      allowNull: true 
    },
    userRole: { 
      type: DataTypes.STRING, 
      allowNull: true 
    },
    action: { 
      type: DataTypes.STRING, 
      allowNull: false,
      comment: 'Tipo de acción: LOGIN, LOGOUT, CREATE, UPDATE, DELETE, BLOCK, UNBLOCK, RESET_PASSWORD, IMPERSONATE, etc.'
    },
    entityType: { 
      type: DataTypes.STRING, 
      allowNull: true,
      comment: 'Tipo de entidad afectada: User, Business, Appointment, etc.'
    },
    entityId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID de la entidad afectada'
    },
    description: { 
      type: DataTypes.TEXT, 
      allowNull: true,
      comment: 'Descripción detallada de la acción'
    },
    oldValues: { 
      type: DataTypes.JSON, 
      allowNull: true,
      comment: 'Valores anteriores (para updates)'
    },
    newValues: { 
      type: DataTypes.JSON, 
      allowNull: true,
      comment: 'Nuevos valores'
    },
    ipAddress: { 
      type: DataTypes.STRING, 
      allowNull: true 
    },
    userAgent: { 
      type: DataTypes.TEXT, 
      allowNull: true 
    },
    metadata: { 
      type: DataTypes.JSON, 
      allowNull: true,
      comment: 'Datos adicionales contextuales'
    }
  }, {
    tableName: 'ActivityLogs',
    timestamps: true,
    indexes: [
      { fields: ['userId'] },
      { fields: ['action'] },
      { fields: ['entityType'] },
      { fields: ['createdAt'] },
      { fields: ['userId', 'action'] },
      { fields: ['entityType', 'entityId'] }
    ]
  });
};
