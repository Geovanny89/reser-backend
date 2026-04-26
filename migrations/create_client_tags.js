module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Verificar si las tablas ya existen
    const tables = await queryInterface.showAllTables();
    
    // ClientTags
    if (!tables.includes('ClientTags')) {
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
      console.log('✅ Tabla ClientTags creada');
    } else {
      console.log('⚠️ Tabla ClientTags ya existe');
    }

    // ClientTagAssignments
    if (!tables.includes('ClientTagAssignments')) {
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
      console.log('✅ Tabla ClientTagAssignments creada');
    } else {
      console.log('⚠️ Tabla ClientTagAssignments ya existe');
    }

    // Índices - agregar solo si no existen
    try {
      await queryInterface.addIndex('ClientTags', ['businessId']);
      console.log('✅ Índice ClientTags_businessId creado');
    } catch (e) {
      console.log('⚠️ Índice ClientTags_businessId ya existe');
    }

    try {
      await queryInterface.addIndex('ClientTagAssignments', ['businessId']);
      console.log('✅ Índice ClientTagAssignments_businessId creado');
    } catch (e) {
      console.log('⚠️ Índice ClientTagAssignments_businessId ya existe');
    }

    try {
      await queryInterface.addIndex('ClientTagAssignments', ['clientTagId']);
      console.log('✅ Índice ClientTagAssignments_clientTagId creado');
    } catch (e) {
      console.log('⚠️ Índice ClientTagAssignments_clientTagId ya existe');
    }

    try {
      await queryInterface.addIndex('ClientTagAssignments', ['businessId', 'clientPhone'], {
        name: 'client_tag_assignment_phone_idx'
      });
      console.log('✅ Índice client_tag_assignment_phone_idx creado');
    } catch (e) {
      console.log('⚠️ Índice client_tag_assignment_phone_idx ya existe');
    }

    try {
      await queryInterface.addIndex('ClientTagAssignments', ['businessId', 'clientEmail'], {
        name: 'client_tag_assignment_email_idx'
      });
      console.log('✅ Índice client_tag_assignment_email_idx creado');
    } catch (e) {
      console.log('⚠️ Índice client_tag_assignment_email_idx ya existe');
    }
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('ClientTagAssignments');
    await queryInterface.dropTable('ClientTags');
  }
};
