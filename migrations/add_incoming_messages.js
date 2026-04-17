/**
 * Migración: Crear tabla IncomingMessages para guardar mensajes entrantes de WhatsApp
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { DataTypes } = Sequelize;
    
    await queryInterface.createTable('IncomingMessages', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      businessId: {
        type: DataTypes.UUID,
        allowNull: false
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: false
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      whatsappMessageId: {
        type: DataTypes.STRING,
        allowNull: true
      },
      status: {
        type: DataTypes.STRING(20),
        defaultValue: 'pending',
        allowNull: false
      },
      processedAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      retryCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });
    
    // Índices para búsquedas eficientes
    await queryInterface.addIndex('IncomingMessages', ['businessId']);
    await queryInterface.addIndex('IncomingMessages', ['phone']);
    await queryInterface.addIndex('IncomingMessages', ['status']);
    await queryInterface.addIndex('IncomingMessages', ['createdAt']);
    
    console.log('[Migration] ✓ Tabla IncomingMessages creada exitosamente');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('IncomingMessages');
    console.log('[Migration] ✓ Tabla IncomingMessages eliminada');
  }
};
