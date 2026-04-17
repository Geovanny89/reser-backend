module.exports = {
  up: async (queryInterface, Sequelize) => {
    // InventoryItems
    await queryInterface.createTable('InventoryItems', {
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
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      unit: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'unidad'
      },
      currentStock: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0
      },
      minStock: {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0
      },
      costPerUnit: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true
      },
      supplier: {
        type: Sequelize.STRING,
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

    // InventoryUsages
    await queryInterface.createTable('InventoryUsages', {
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
      itemId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'InventoryItems',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      appointmentId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Appointments',
          key: 'id'
        },
        onDelete: 'SET NULL'
      },
      quantity: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      date: {
        type: Sequelize.DATEONLY,
        allowNull: false
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      usedBy: {
        type: Sequelize.UUID,
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

    await queryInterface.addIndex('InventoryItems', ['businessId']);
    await queryInterface.addIndex('InventoryUsages', ['businessId']);
    await queryInterface.addIndex('InventoryUsages', ['itemId']);
    await queryInterface.addIndex('InventoryUsages', ['appointmentId']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('InventoryUsages');
    await queryInterface.dropTable('InventoryItems');
  }
};
