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
    paymentScreenshotViewed: { type: DataTypes.BOOLEAN, defaultValue: false },
    paymentAmount: { type: DataTypes.INTEGER },
    paymentMethod: { type: DataTypes.STRING },
    paymentReference: { type: DataTypes.STRING },
    lastPaymentDate: { type: DataTypes.DATE },
    customMonthlyPrice: { type: DataTypes.INTEGER },

    
    // Nuevos campos para planes de suscripción por usuarios
    subscriptionPlan: { 
      type: DataTypes.ENUM('basic', 'pro', 'premium'), 
      defaultValue: 'basic',
      comment: 'Plan de suscripción: basic (3 users), pro (5 users), premium (10 users)' 
    },
    includedUsers: { 
      type: DataTypes.INTEGER, 
      defaultValue: 3,
      comment: 'Usuarios incluidos según el plan' 
    },
    additionalUsers: { 
      type: DataTypes.INTEGER, 
      defaultValue: 0,
      comment: 'Usuarios adicionales contratados' 
    },
    additionalUserPrice: { 
      type: DataTypes.INTEGER, 
      defaultValue: 20000,
      comment: 'Precio por usuario adicional (COP)' 
    },
    monthlyTotal: { 
      type: DataTypes.INTEGER, 
      defaultValue: 70000,
      comment: 'Total mensual calculado' 
    },
    
    // Configuración de sucursales
    isBranch: { type: DataTypes.BOOLEAN, defaultValue: false },
    parentBusinessId: { type: DataTypes.UUID },
    branchStatus: { type: DataTypes.ENUM('approved', 'pending_approval', 'rejected'), defaultValue: 'approved' },
    branchPaymentScreenshot: { type: DataTypes.STRING }, // Comprobante del 50% extra para activar sucursal
    
    // Datos bancarios para pagos (Admin)
    adminNequiNumber: { type: DataTypes.STRING },
    adminLlaveBancaria: { type: DataTypes.STRING },
    adminBankName: { type: DataTypes.STRING },
    adminAccountNumber: { type: DataTypes.STRING },


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
    
    // === Campo para Técnicos a Domicilio (Seguimiento en campo) ===
    hasFieldTechnicians: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si envía técnicos a domicilio con seguimiento en tiempo real (deshabilita WhatsApp, menú especial)' },

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

    // === Configuración de módulos opcionales ===
    enabledModules: { 
      type: DataTypes.JSON, 
      defaultValue: { expenses: false, inventory: false, deposits: false },
      comment: 'Módulos opcionales habilitados: expenses, inventory, deposits'
    },
    
    // === Configuración de anticipos/depositos ===
    depositConfig: {
      type: DataTypes.JSON,
      defaultValue: {
        required: false,              // ¿Anticipo obligatorio?
        amount: 0,                  // Monto fijo (0 = usar porcentaje)
        percentage: 30,             // Porcentaje del servicio (si amount = 0)
        cancelationHours: 24,       // Horas antes para cancelar sin penalidad
        penaltyEnabled: true,         // ¿Penalidad por no asistir?
        termsText: 'El anticipo garantiza tu cita. Si cancelas con menos de 24 horas de anticipo o no asistes, el anticipo será retenido como penalidad. Puedes reagendar una vez sin costo adicional.'
      },
      comment: 'Configuración de anticipos: requerido, monto, condiciones de penalidad'
    },

    // === Configuración de caja registradora ===
    includeTransfersInCashRegister: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Indica si las transferencias se incluyen en el total de caja registradora'
    },

    // === CAMPOS DE REFERIDOS ===
    referralCode: { 
      type: DataTypes.STRING, 
      unique: true, 
      comment: 'Código único para que otros se registren con este negocio' 
    },
    referredByCode: { 
      type: DataTypes.STRING, 
      comment: 'Código del negocio que refirió a este' 
    },
    referralDate: { 
      type: DataTypes.DATE, 
      comment: 'Fecha en que se completó la referencia' 
    }
  }, {
    indexes: [
      { fields: ['slug'], name: 'idx_business_slug', unique: true },
      { fields: ['ownerId'], name: 'idx_business_ownerId' },
      { fields: ['status'], name: 'idx_business_status' },
      { fields: ['subscriptionStatus'], name: 'idx_business_subscription' }
    ]
  });

  Business.resolveWhatsAppBusinessId = async function(businessId) {
    const biz = await this.findByPk(businessId);
    if (biz && biz.isBranch && biz.useParentWhatsApp && biz.parentBusinessId) {
      return biz.parentBusinessId;
    }
    return businessId;
  };

  Business.beforeCreate(async (b) => {
    // Generar código de referido único aleatorio (6 caracteres)
    if (!b.referralCode) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Evitamos O, 0, I, 1 para evitar confusiones
      let code = '';
      let isUnique = false;
      
      while (!isUnique) {
        code = '';
        for (let i = 0; i < 6; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        // Verificar unicidad
        const existing = await b.constructor.findOne({ where: { referralCode: code } });
        if (!existing) isUnique = true;
      }
      b.referralCode = code;
    }

    // Si es una sucursal, crear slug combinado: principal$sucursal
    if (b.isBranch && b.parentBusinessId) {
      const parentBusiness = await b.constructor.findByPk(b.parentBusinessId);
      if (parentBusiness) {
        const parentSlug = parentBusiness.slug;
        const branchSlug = slugify(b.name, { lower: true, strict: true });
        let combinedSlug = `${parentSlug}$${branchSlug}`;
        
        // Verificar unicidad y agregar sufijo si es necesario
        let count = 1;
        let finalSlug = combinedSlug;
        while (await b.constructor.findOne({ where: { slug: finalSlug } })) {
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
    while (await b.constructor.findOne({ where: { slug } })) {
      slug = `${baseSlug}-${count++}`;
    }
    b.slug = slug;
  });

  // El slug NO se regenera automáticamente al cambiar el nombre
  // para mantener los enlaces existentes funcionando
  // Si se necesita cambiar el slug, hacerlo manualmente

  return Business;
};
