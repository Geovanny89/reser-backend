/**
 * Trackers de actividad para el scheduler contextual
 */

const { GLOBAL_LIMIT_PER_MINUTE } = require('./config');

const businessActivityTracker = new Map(); // businessId -> { messageTimestamps: [], lastSent: null }
const humanActivityTracker = new Map(); // businessId -> { lastHumanMessageTimestamp: null }
const globalMessageTracker = []; // Array de timestamps de mensajes enviados globalmente

/**
 * Registra un mensaje enviado para el tracker (ventana móvil)
 */
function registerMessageSent(businessId) {
  const now = Date.now();

  if (!businessActivityTracker.has(businessId)) {
    businessActivityTracker.set(businessId, { messageTimestamps: [], lastSent: null });
  }

  const tracker = businessActivityTracker.get(businessId);
  tracker.messageTimestamps.push(now);
  tracker.lastSent = now;

  // También registrar en tracker global
  globalMessageTracker.push(now);
  // Limpiar tracker global (más de 1 minuto)
  const oneMinuteAgo = now - 60 * 1000;
  while (globalMessageTracker.length > 0 && globalMessageTracker[0] < oneMinuteAgo) {
    globalMessageTracker.shift();
  }
}

/**
 * Registra actividad humana (mensaje enviado por humano) para un negocio
 */
function registerHumanActivity(businessId) {
  const now = Date.now();
  if (!humanActivityTracker.has(businessId)) {
    humanActivityTracker.set(businessId, { lastHumanMessageTimestamp: null });
  }
  const tracker = humanActivityTracker.get(businessId);
  tracker.lastHumanMessageTimestamp = now;
}

/**
 * Verifica si hay actividad humana reciente (chat en curso)
 * Retorna el delay necesario para no interrumpir el flujo natural
 */
function checkHumanActivityDelay(businessId) {
  const now = Date.now();
  const minDelay = 2 * 60 * 1000; // 2 minutos mínimo
  const maxDelay = 5 * 60 * 1000; // 5 minutos máximo

  if (!humanActivityTracker.has(businessId)) {
    return 0;
  }

  const tracker = humanActivityTracker.get(businessId);
  const lastHumanActivity = tracker.lastHumanMessageTimestamp;

  if (!lastHumanActivity) {
    return 0;
  }

  const timeSinceHumanActivity = now - lastHumanActivity;

  if (timeSinceHumanActivity < minDelay) {
    return minDelay - timeSinceHumanActivity;
  } else if (timeSinceHumanActivity < maxDelay) {
    const normalizedTime = (timeSinceHumanActivity - minDelay) / (maxDelay - minDelay);
    const skewedDelay = (1 - Math.pow(normalizedTime, 0.5)) * (maxDelay - minDelay);
    return Math.max(0, skewedDelay);
  }

  return 0;
}

/**
 * Verifica backpressure global por servidor
 */
function checkGlobalBackpressure() {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const messagesInLastMinute = globalMessageTracker.filter(ts => ts > oneMinuteAgo).length;
  return messagesInLastMinute < GLOBAL_LIMIT_PER_MINUTE;
}

module.exports = {
  businessActivityTracker,
  humanActivityTracker,
  registerMessageSent,
  registerHumanActivity,
  checkHumanActivityDelay,
  checkGlobalBackpressure
};
