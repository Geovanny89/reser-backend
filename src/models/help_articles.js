const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('HelpArticle', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Título del artículo o guía'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Contenido detallado de la guía (puede ser HTML)'
    },
    category: {
      type: DataTypes.STRING,
      defaultValue: 'general',
      comment: 'Categoría: citas, inventario, reportes, etc.'
    },
    keywords: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Palabras clave separadas por coma para búsqueda'
    },
    role: {
      type: DataTypes.ENUM('admin', 'superadmin', 'all'),
      defaultValue: 'admin',
      comment: 'Nivel de acceso requerido para ver este artículo'
    },
    order: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Orden de visualización'
    },
    imageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'URL de la imagen explicativa en Cloudinary'
    },
    imagePublicId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID público en Cloudinary para borrado'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'HelpArticles',
    indexes: [
      { fields: ['category'] },
      { fields: ['isActive'] }
    ]
  });
};
