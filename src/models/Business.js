const { DataTypes } = require('sequelize');
const slugify = require('slugify');

module.exports = (sequelize) => {
  const Business = sequelize.define('Business', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    ownerId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING,
      unique: true,
    },
    type: {
      type: DataTypes.STRING,
      defaultValue: 'otro', // barberia, spa, uñas, taller, veterinaria, etc.
    },
    description: {
      type: DataTypes.TEXT,
    },
    phone: {
      type: DataTypes.STRING,
    },
    address: {
      type: DataTypes.STRING,
    },
    logoUrl: {
      type: DataTypes.STRING,
    },
    bannerUrl: {
      type: DataTypes.STRING,
    },
    gallery: {
      type: DataTypes.JSON,
      defaultValue: [],
    },
    primaryColor: {
      type: DataTypes.STRING,
      defaultValue: '#667eea',
    },
    secondaryColor: {
      type: DataTypes.STRING,
      defaultValue: '#764ba2',
    },
    tagline: {
      type: DataTypes.STRING,
    },
    ctaText: {
      type: DataTypes.STRING,
      defaultValue: 'Reservar cita ahora',
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'blocked'),
      defaultValue: 'active',
    },
    
    // Configuración de suscripción y pagos
    subscriptionStatus: { type: DataTypes.ENUM('active', 'inactive', 'pending', 'paid', 'overdue'), defaultValue: 'pending' },
    subscriptionStartDate: { type: DataTypes.DATE },
    subscriptionEndDate: { type: DataTypes.DATE },
    paymentScreenshot: { type: DataTypes.STRING }, // Comprobante de pago mensual
    
    // Configuración de sucursales
    isBranch: { type: DataTypes.BOOLEAN, defaultValue: false },
    parentBusinessId: { type: DataTypes.UUID },
    branchStatus: { type: DataTypes.ENUM('approved', 'pending_approval', 'rejected'), defaultValue: 'approved' },
    branchPaymentScreenshot: { type: DataTypes.STRING }, // Comprobante del 50% extra para activar sucursal

    // Horarios
    businessHours: { type: DataTypes.TEXT },
    metaDescription: { type: DataTypes.STRING },

    // Configuración de WhatsApp
    whatsappReminders: { type: DataTypes.BOOLEAN, defaultValue: false },
    whatsappStatus: { type: DataTypes.ENUM('disconnected', 'connecting', 'connected'), defaultValue: 'disconnected' },
    whatsappRemindersTime: { type: DataTypes.INTEGER, defaultValue: 2, comment: 'Horas antes para enviar recordatorio' },

    // === CAMPOS DE PERSONALIZACIÓN DE PÁGINA PÚBLICA ===
    whatsapp:    { type: DataTypes.STRING },
    whatsappCatalog: { type: DataTypes.STRING, comment: 'Enlace al catálogo de WhatsApp' },
    instagram:   { type: DataTypes.STRING },
    facebook:    { type: DataTypes.STRING },
    tiktok:      { type: DataTypes.STRING },
    twitter:     { type: DataTypes.STRING },
    pinterest:   { type: DataTypes.STRING },
    youtube:     { type: DataTypes.STRING },
    website:     { type: DataTypes.STRING },
    
    // === Campo para Servicios Técnicos ===
    isTechnicalServices: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si es negocio de servicios técnicos (genera OS en lugar de recibo)' },
    nit: { type: DataTypes.STRING, comment: 'NIT del negocio para recibos/OS' },

    // === Campos para métodos de pago en landing ===
    showPaymentMethods: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Mostrar métodos de pago en la landing page' },
    paymentMethods: { type: DataTypes.JSON, defaultValue: [], comment: 'Array de métodos de pago [{name, number, icon}]' },
    
    // === Campos para misión y visión ===
    showMissionVision: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Mostrar sección de misión y visión en la landing page' },
    mission: { type: DataTypes.TEXT, comment: 'Misión de la empresa' },
    vision: { type: DataTypes.TEXT, comment: 'Visión de la empresa' },

    // === Campo para WhatsApp en sucursales ===
    useParentWhatsApp: { type: DataTypes.BOOLEAN, defaultValue: true, comment: 'Indica si la sucursal usa el WhatsApp del negocio principal' },
    
    // === Campo para Google Maps ===
    googleMapsUrl: { type: DataTypes.STRING, comment: 'URL de Google Maps para mostrar ubicación en la landing page' },
  });

  Business.resolveWhatsAppBusinessId = async function(businessId) {
    const biz = await this.findByPk(businessId);
    if (biz && biz.isBranch && biz.useParentWhatsApp && biz.parentBusinessId) {
      return biz.parentBusinessId;
    }
    return businessId;
  };

  Business.beforeCreate(async (b) => {
    // Si es una sucursal, crear slug combinado: principal$sucursal
    if (b.isBranch && b.parentBusinessId) {
      const parentBusiness = await Business.findByPk(b.parentBusinessId);
      if (parentBusiness) {
        const parentSlug = parentBusiness.slug;
        const branchSlug = slugify(b.name, { lower: true, strict: true });
        let combinedSlug = `${parentSlug}$${branchSlug}`;
        
        // Verificar unicidad y agregar sufijo si es necesario
        let count = 1;
        let finalSlug = combinedSlug;
        while (await Business.findOne({ where: { slug: finalSlug } })) {
          finalSlug = `${combinedSlug}-${count++}`;
        }
        b.slug = finalSlug;
        return;
      }
    }
    
    // Slug normal para negocios principales
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
