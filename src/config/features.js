/**
 * Feature Flags - Control de versionado de código
 * 
 * Reglas:
 * 1. Nunca cambiar una feature a 'true' en producción sin probar en staging
 * 2. Cada feature debe tener rollback inmediato (cambiar a 'false')
 * 3. Documentar fecha de activación y responsable
 */

const features = {
  // ============================================================
  // WHATSAPP SERVICE - Refactorización progresiva
  // ============================================================
  
  // Usar nuevo servicio de WhatsApp modularizado
  // Fecha activación: __/__/____
  // Responsable: _____
  // Estado: false (usar código original)
  whatsappServiceV2: process.env.WHATSAPP_V2 === 'true' || false,
  
  // Usar templates extraídos a archivos separados
  // Fecha activación: __/__/____
  whatsappTemplatesV2: process.env.WHATSAPP_TEMPLATES_V2 === 'true' || false,
  
  // Usar rate limiter independiente
  // Fecha activación: __/__/____
  whatsappRateLimiterV2: process.env.WHATSAPP_RATE_V2 === 'true' || false,

  // ============================================================
  // APPOINTMENT CONTROLLER - Refactorización progresiva
  // ============================================================
  
  // Usar nuevo controller modularizado
  // Fecha activación: __/__/____
  // Responsable: _____
  appointmentControllerV2: process.env.APPOINTMENT_V2 === 'true' || false,
  
  // Usar validadores separados
  // Fecha activación: __/__/____
  appointmentValidatorsV2: process.env.APPOINTMENT_VALIDATORS_V2 === 'true' || false,

  // ============================================================
  // UTILIDADES - Mejoras pequeñas y seguras
  // ============================================================
  
  // Usar logger centralizado en lugar de console.log
  // Fecha activación: __/__/____
  useCentralizedLogger: process.env.USE_LOGGER === 'true' || false,
  
  // Usar manejo de errores estandarizado
  // Fecha activación: __/__/____
  useStandardizedErrors: process.env.USE_STD_ERRORS === 'true' || false,
};

/**
 * Obtener el valor de una feature flag
 * @param {string} featureName - Nombre de la feature
 * @returns {boolean} - Estado de la feature
 */
function isEnabled(featureName) {
  return !!features[featureName];
}

/**
 * Listar todas las features y su estado
 * Útil para endpoints de health-check
 */
function getAllFeatures() {
  return {
    ...features,
    _meta: {
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    }
  };
}

module.exports = {
  isEnabled,
  getAllFeatures,
  features,
};
