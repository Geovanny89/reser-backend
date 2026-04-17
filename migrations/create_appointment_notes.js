module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('AppointmentNotes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Appointments',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      authorId: {
        type: Sequelize.UUID,
        allowNull: true
      },
      authorName: {
        type: Sequelize.STRING,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Agregar índice para búsquedas por appointmentId
    await queryInterface.addIndex('AppointmentNotes', ['appointmentId']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('AppointmentNotes');
  }
};
