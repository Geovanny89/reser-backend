const { DataTypes } = require('sequelize');
const slugify = require('slugify');

module.exports = (sequelize) => {
  const Business = sequelize.define('Business', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name:        { type: DataTypes.STRING, allowNull: false },
    slug:        { type: DataTypes.STRING, unique: true },
    type:        { type: DataTypes.STRING, allowNull: false, defaultValue: 'otro' },
    description: { type: DataTypes.TEXT },
    phone:       { type: DataTypes.STRING },
    address:     { type: DataTypes.STRING },
    logoUrl:     { type: DataTypes.STRING },
    ownerId:     { type: DataTypes.UUID, allowNull: false },
    status:      { type: DataTypes.ENUM('active', 'blocked'), defaultValue: 'active' },
    subscriptionStatus: { type: DataTypes.ENUM('pending', 'paid', 'overdue'), defaultValue: 'pending' },
    subscriptionStartDate: { type: DataTypes.DATE },
    subscriptionEndDate: { type: DataTypes.DATE },
    lastPaymentDate: { type: DataTypes.DATE },
    paymentScreenshot: { type: DataTypes.STRING },
    paymentScreenshotViewed: { type: DataTypes.BOOLEAN, defaultValue: false },
    paymentAmount: { type: DataTypes.DECIMAL(10, 2) },
    paymentMethod: { type: DataTypes.ENUM('nequi', 'llave', 'transferencia', 'otro') },
    paymentReference: { type: DataTypes.STRING },

    // === CAMPOS DE DATOS DE PAGO DEL NEGOCIO (para notificar al admin) ===
    adminNequiNumber: { type: DataTypes.STRING },
    adminLlaveBancaria: { type: DataTypes.STRING },
    adminBankName: { type: DataTypes.STRING },
    adminAccountNumber: { type: DataTypes.STRING },

    // === CAMPOS DE PERSONALIZACIÓN DE PÁGINA PÚBLICA ===
    whatsapp:    { type: DataTypes.STRING },
    instagram:   { type: DataTypes.STRING },
    facebook:    { type: DataTypes.STRING },
    tiktok:      { type: DataTypes.STRING },
    twitter:     { type: DataTypes.STRING },
    website:     { type: DataTypes.STRING },
    gallery:     { type: DataTypes.TEXT, defaultValue: '[]' },
    bannerUrl:   { type: DataTypes.STRING },
    primaryColor:   { type: DataTypes.STRING, defaultValue: '#667eea' },
    secondaryColor: { type: DataTypes.STRING, defaultValue: '#764ba2' },
    tagline:        { type: DataTypes.STRING },
    ctaText:        { type: DataTypes.STRING, defaultValue: 'Reservar cita ahora' },
    businessHours:  { type: DataTypes.TEXT },
    metaDescription: { type: DataTypes.STRING },
    
    // === Campo para empresas de servicios técnicos ===
    isTechnicalServices: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Es empresa de soporte técnico (cámaras, computadores, etc)' },
  });

  Business.beforeCreate(async (b) => {
    let baseSlug = slugify(b.name, { lower: true, strict: true });
    let slug = baseSlug;
    let count = 1;
    while (await Business.findOne({ where: { slug } })) {
      slug = `${baseSlug}-${count++}`;
    }
    b.slug = slug;
  });

  // El slug NO se regenera automáticamente al cambiar el nombre
  // para mantener los enlaces existentes funcionando
  // Si se necesita cambiar el slug, hacerlo manualmente

  return Business;
};
