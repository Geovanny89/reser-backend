/**
 * Constantes para el módulo de negocios
 */

// Zona horaria Colombia: UTC-5 (no cambia con horario de verano)
exports.COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;

// Configuración de planes (precios y usuarios incluidos)
exports.SUBSCRIPTION_PLANS = {
  basic: { name: 'Básico', price: 70000, includedUsers: 2 },
  pro: { name: 'Pro', price: 90000, includedUsers: 5 },
  premium: { name: 'Premium', price: 130000, includedUsers: 10 }
};

exports.ADDITIONAL_USER_PRICE = 20000;

// Campos permitidos para actualización
exports.ALLOWED_UPDATE_FIELDS = [
  'name', 'type', 'description', 'phone', 'address', 'logoUrl', 'bannerUrl',
  'whatsapp', 'whatsappCatalog', 'instagram', 'facebook', 'tiktok', 'twitter', 'pinterest', 'youtube', 'website',
  'gallery', 'primaryColor', 'secondaryColor', 'tagline', 'ctaText',
  'businessHours', 'metaDescription', 'isTechnicalServices', 'hasFieldTechnicians',
  'showPaymentMethods', 'paymentMethods', 'useParentWhatsApp',
  'showMissionVision', 'mission', 'vision', 'googleMapsUrl',
  'enabledModules', 'depositConfig', 'includeTransfersInCashRegister',
];
