const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('AppointmentNote', {
    id: { 
      type: DataTypes.UUID, 
      defaultValue: DataTypes.UUIDV4, 
      primaryKey: true 
    },
    appointmentId: { 
      type: DataTypes.UUID, 
      allowNull: false,
      comment: 'ID de la cita relacionada'
    },
    content: { 
      type: DataTypes.TEXT, 
      allowNull: false,
      comment: 'Contenido de la nota'
    },
    authorId: { 
      type: DataTypes.UUID, 
      allowNull: true,
      comment: 'ID del usuario que creó la nota'
    },
    authorName: { 
      type: DataTypes.STRING, 
      allowNull: true,
      comment: 'Nombre del autor (para mostrar)'
    }
  }, {
    tableName: 'AppointmentNotes',
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  });
};
