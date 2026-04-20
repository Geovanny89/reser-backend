const { DataTypes } = require('sequelize');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('ActivityLogs', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
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
        allowNull: false
      },
      entityType: {
        type: DataTypes.STRING,
        allowNull: true
      },
      entityId: {
        type: DataTypes.UUID,
        allowNull: true
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      oldValues: {
        type: DataTypes.JSON,
        allowNull: true
      },
      newValues: {
        type: DataTypes.JSON,
        allowNull: true
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
        allowNull: true
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW')
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW')
      }
    });

    // Crear índices
    await queryInterface.addIndex('ActivityLogs', ['userId'], {
      name: 'activity_logs_user_id_idx'
    });
    await queryInterface.addIndex('ActivityLogs', ['action'], {
      name: 'activity_logs_action_idx'
    });
    await queryInterface.addIndex('ActivityLogs', ['entityType'], {
      name: 'activity_logs_entity_type_idx'
    });
    await queryInterface.addIndex('ActivityLogs', ['createdAt'], {
      name: 'activity_logs_created_at_idx'
    });
    await queryInterface.addIndex('ActivityLogs', ['userId', 'action'], {
      name: 'activity_logs_user_action_idx'
    });
    await queryInterface.addIndex('ActivityLogs', ['entityType', 'entityId'], {
      name: 'activity_logs_entity_idx'
    });

    console.log('✅ Tabla ActivityLogs creada con índices');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('ActivityLogs');
    console.log('⬇️ Tabla ActivityLogs eliminada');
  }
};
