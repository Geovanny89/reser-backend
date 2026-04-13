const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ClientTagAssignment = sequelize.define('ClientTagAssignment', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    businessId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Negocio al que pertenece esta asignación'
    },
    clientTagId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID de la etiqueta asignada'
    },
    clientPhone: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Teléfono del cliente (identificador principal)'
    },
    clientEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Email del cliente (identificador alternativo)'
    },
    clientName: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Nombre del cliente (para referencia)'
    },
    notes: {
      type: DataTypes.TEXT,
      comment: 'Notas adicionales sobre este cliente'
    }
  }, {
    indexes: [
      {
        fields: ['businessId', 'clientPhone'],
        name: 'client_tag_assignment_phone_idx'
      },
      {
        fields: ['businessId', 'clientEmail'],
        name: 'client_tag_assignment_email_idx'
      }
    ]
  });

  return ClientTagAssignment;
};
