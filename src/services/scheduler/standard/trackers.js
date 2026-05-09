/**
 * Trackers de warm-up y rate limiting para el scheduler estándar
 */

const CONFIG = require('./config');

const messageTimestampsByBusiness = new Map();
const whatsappWarmUpTracker = new Map(); // businessId -> { createdAt, messageCount }

/**
 * Obtiene el límite de mensajes por minuto basado en warm-up del número
 */
function getWarmUpLimit(businessId) {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (!whatsappWarmUpTracker.has(businessId)) {
    whatsappWarmUpTracker.set(businessId, { createdAt: now, messageCount: 0 });
    return 2;
  }

  const warmUpData = whatsappWarmUpTracker.get(businessId);
  const daysSinceCreation = (now - warmUpData.createdAt) / DAY_MS;

  if (daysSinceCreation < 1) return 2;
  if (daysSinceCreation < 3) return 3;
  if (daysSinceCreation < 7) return 4;
  return CONFIG.MAX_MESSAGES_PER_MINUTE;
}

/**
 * Incrementa contador de mensajes para warm-up
 */
function incrementWarmUpCount(businessId) {
  if (whatsappWarmUpTracker.has(businessId)) {
    const data = whatsappWarmUpTracker.get(businessId);
    data.messageCount++;
    whatsappWarmUpTracker.set(businessId, data);
  }
}

/**
 * Verifica y aplica límite de velocidad por negocio
 */
function checkRateLimit(businessId) {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const dynamicLimit = getWarmUpLimit(businessId);

  if (!messageTimestampsByBusiness.has(businessId)) {
    messageTimestampsByBusiness.set(businessId, []);
  }

  const timestamps = messageTimestampsByBusiness.get(businessId);
  const recentTimestamps = timestamps.filter(ts => ts > oneMinuteAgo);
  messageTimestampsByBusiness.set(businessId, recentTimestamps);

  if (recentTimestamps.length >= dynamicLimit) {
    const oldestTimestamp = recentTimestamps[0];
    const timeUntilOldestExpires = oldestTimestamp + 60 * 1000 - now;
    if (timeUntilOldestExpires > 0) {
      console.log(`[Scheduler] ⏸️ Rate limit para ${businessId}: esperando ${Math.round(timeUntilOldestExpires / 1000)}s para respetar límite de ${dynamicLimit} msgs/min (warm-up)`);
      return timeUntilOldestExpires;
    }
  }

  recentTimestamps.push(now);
  messageTimestampsByBusiness.set(businessId, recentTimestamps);
  incrementWarmUpCount(businessId);

  return 0;
}

module.exports = {
  checkRateLimit,
  incrementWarmUpCount,
  getWarmUpLimit
};
