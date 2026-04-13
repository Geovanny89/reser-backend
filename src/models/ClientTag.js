const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ClientTag = sequelize.define('ClientTag', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Negocio al que pertenece esta etiqueta'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Nombre de la etiqueta (ej: VIP, Nuevo, Frecuente)'
    },
    color: {
      type: DataTypes.STRING,
      defaultValue: '#667eea',
      comment: 'Color de la etiqueta en formato hex'
    },
    description: {
      type: DataTypes.TEXT,
      comment: 'Descripción opcional de la etiqueta'
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  });

  return ClientTag;
};
