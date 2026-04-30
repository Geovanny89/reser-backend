/**
 * Configuración del Scheduler
 */

// Control de procesamiento
let isProcessing = false;

const CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 60000, // 1 minuto entre reintentos
  BUSINESS_TIMEOUT_MS: 20 * 60 * 1000, // 20 minutos máximo por negocio (antes 6 min)
  DELAY_BETWEEN_MESSAGES_MIN: 10000, // 10s mín entre mensajes (anti-bloqueo)
  DELAY_BETWEEN_MESSAGES_MAX: 20000, // 20s máx entre mensajes (anti-bloqueo)
  DELAY_BETWEEN_MESSAGES_HUMAN_MIN: 25000, // 25s para negocios con ≤3 msgs
  DELAY_BETWEEN_MESSAGES_HUMAN_MAX: 45000, // 45s para negocios con ≤3 msgs
  DELAY_BETWEEN_BUSINESSES: 5000, // 5s entre lotes de negocios paralelos
  SYNC_WAIT_MS: 2000, // 2s espera sincronización WhatsApp (antes 5s)
  RESPONSE_WAIT_MS: 0, // No bloquear scheduler por respuestas (antes 5 min)
  BATCH_LIMIT: 1000, // máximo 1000 mensajes por ciclo (antes 100)
  CONCURRENT_BUSINESSES: 5, // Negocios procesados en paralelo
  MAX_MESSAGES_PER_MINUTE: 3, // Máximo 3 mensajes por minuto por negocio (anti-bloqueo)
  HUMAN_PAUSE_INTERVAL: 15, // Pausa human-like cada 15 mensajes
  HUMAN_PAUSE_MIN_MS: 2 * 60 * 1000, // 2 minutos mínimo de pausa
  HUMAN_PAUSE_MAX_MS: 5 * 60 * 1000, // 5 minutos máximo de pausa
  INCOMING_BATCH_LIMIT: 200, // máximo 200 mensajes entrantes por ejecución (antes 50)
  INCOMING_MAX_AGE_DAYS: 7, // 7 días de antigüedad máxima para mensajes entrantes
  PROCESSING_TIMEOUT_MINUTES: 14, // minutos antes de forzar reset del flag isProcessing (antes 5)
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
