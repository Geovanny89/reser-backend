/**
 * Configuración del Scheduler
 */

// Control de procesamiento
let isProcessing = false;

const CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 60000, // 1 minuto entre reintentos
  BUSINESS_TIMEOUT_MS: 6 * 60 * 1000, // 6 minutos máximo por negocio
  DELAY_BETWEEN_MESSAGES_MIN: 30000, // 30 segundos mínimo entre mensajes
  DELAY_BETWEEN_MESSAGES_MAX: 60000, // 60 segundos máximo entre mensajes
  DELAY_BETWEEN_BUSINESSES: 10000, // 10 segundos entre negocios
  SYNC_WAIT_MS: 5000, // 5 segundos espera sincronización WhatsApp
  RESPONSE_WAIT_MS: 5 * 60 * 1000, // 5 minutos espera respuesta cliente
  BATCH_LIMIT: 100, // máximo 100 mensajes por ciclo
  INCOMING_BATCH_LIMIT: 50, // máximo 50 mensajes entrantes por ejecución
  INCOMING_MAX_AGE_DAYS: 7, // 7 días de antigüedad máxima para mensajes entrantes
  PROCESSING_TIMEOUT_MINUTES: 5, // minutos antes de forzar reset del flag isProcessing
};

const RESPONSE_TYPES = ['rating', 'confirmation'];

function getIsProcessing() {
  return isProcessing;
}

function setIsProcessing(value) {
  isProcessing = value;
}

module.exports = {
  CONFIG,
  RESPONSE_TYPES,
  getIsProcessing,
  setIsProcessing,
};
