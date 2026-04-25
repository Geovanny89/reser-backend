module.exports = {
  up: async (queryInterface, Sequelize) => {
    // ClientTags
    await queryInterface.createTable('ClientTags', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      businessId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Businesses',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false
      },
      color: {
        type: Sequelize.STRING,
        defaultValue: '#667eea'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
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

    // ClientTagAssignments
    await queryInterface.createTable('ClientTagAssignments', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true
      },
      businessId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Businesses',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      clientTagId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'ClientTags',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      clientPhone: {
        type: Sequelize.STRING,
        allowNull: true
      },
      clientEmail: {
        type: Sequelize.STRING,
        allowNull: true
      },
      clientName: {
        type: Sequelize.STRING,
        allowNull: true
      },
      notes: {
        type: Sequelize.TEXT,
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

    // Índices
    await queryInterface.addIndex('ClientTags', ['businessId']);
    await queryInterface.addIndex('ClientTagAssignments', ['businessId']);
    await queryInterface.addIndex('ClientTagAssignments', ['clientTagId']);
    await queryInterface.addIndex('ClientTagAssignments', ['businessId', 'clientPhone'], {
      name: 'client_tag_assignment_phone_idx'
    });
    await queryInterface.addIndex('ClientTagAssignments', ['businessId', 'clientEmail'], {
      name: 'client_tag_assignment_email_idx'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('ClientTagAssignments');
    await queryInterface.dropTable('ClientTags');
  }
};
