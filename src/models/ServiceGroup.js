const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('ServiceGroup', {
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    businessId: { 
      type: DataTypes.UUID, 
      allowNull: false,
      comment: 'ID del negocio al que pertenece el grupo'
    },
    name: { 
      type: DataTypes.STRING, 
      allowNull: false,
      comment: 'Nombre del grupo (ej: Uñas, Cabello, Facial)'
    },
    description: { 
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Descripción opcional del grupo'
    },
    imageUrl: { 
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'URL de la imagen en Cloudinary'
    },
    order: { 
      type: DataTypes.INTEGER, 
      defaultValue: 0,
      comment: 'Orden de visualización del grupo'
    },
    active: { 
      type: DataTypes.BOOLEAN, 
      defaultValue: true,
      comment: 'Grupo activo o eliminado'
    }
  }, {
    tableName: 'ServiceGroups',
    timestamps: true,
    indexes: [
      { fields: ['businessId'], name: 'idx_serviceGroup_businessId' },
      { fields: ['businessId', 'active'], name: 'idx_serviceGroup_businessId_active' },
    ]
  });
};
