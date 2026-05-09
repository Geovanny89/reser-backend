/**
 * Análisis de patrones históricos y límites de negocio
 */

const { Appointment, Business } = require('../../../models');
const { Op } = require('sequelize');
const { CONTEXTUAL_CONFIG } = require('./config');
const { businessActivityTracker } = require('./trackers');

const historicalPatternCache = new Map(); // businessId -> { hourlyDistribution: {}, dailyAverage: 0 }

/**
 * Analiza patrones históricos de citas de un negocio
 */
async function analyzeBusinessHistoricalPattern(businessId) {
  const cached = historicalPatternCache.get(businessId);
  if (cached && cached.cachedAt && (Date.now() - cached.cachedAt) < 60 * 60 * 1000) {
    return cached.pattern;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const appointments = await Appointment.findAll({
    where: {
      businessId,
      startTime: { [Op.gte]: thirtyDaysAgo },
      status: { [Op.in]: ['pending', 'confirmed', 'attention', 'done'] }
    },
    attributes: ['startTime']
  });

  const hourlyDistribution = {};
  const dailyCounts = {};

  for (const appt of appointments) {
    const dateObj = new Date(appt.startTime);
    const hourStr = dateObj.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', timeZone: 'America/Bogota' });
    const hour = parseInt(hourStr);
    const dayKey = dateObj.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
    dailyCounts[dayKey] = (dailyCounts[dayKey] || 0) + 1;
  }

  const daysWithData = Object.keys(dailyCounts).length;
  const totalAppointments = appointments.length;
  const dailyAverage = daysWithData > 0 ? totalAppointments / daysWithData : 0;

  const pattern = {
    hourlyDistribution,
    dailyAverage,
    totalAppointments,
    daysWithData
  };

  historicalPatternCache.set(businessId, {
    pattern,
    cachedAt: Date.now()
  });

  return pattern;
}

/**
 * Obtiene el límite de mensajes usando rate smoothing con ventana móvil
 */
async function getBusinessHourlyLimit(businessId) {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  if (!businessActivityTracker.has(businessId)) {
    businessActivityTracker.set(businessId, { messageTimestamps: [], lastSent: null });
  }

  const tracker = businessActivityTracker.get(businessId);
  tracker.messageTimestamps = tracker.messageTimestamps.filter(ts => ts > oneDayAgo);

  const messagesInLastHour = tracker.messageTimestamps.filter(ts => ts > oneHourAgo).length;
  const messagesInLastDay = tracker.messageTimestamps.length;

  const historicalPattern = await analyzeBusinessHistoricalPattern(businessId);

  const baseHourlyLimit = CONTEXTUAL_CONFIG.MAX_MESSAGES_PER_HOUR_PER_BUSINESS;
  const baseDailyLimit = CONTEXTUAL_CONFIG.MAX_MESSAGES_PER_DAY_PER_BUSINESS;

  const historicalDailyAverage = historicalPattern.dailyAverage || 1;
  const patternMultiplier = Math.max(0.5, Math.min(2.0, historicalDailyAverage / 10));

  const adjustedHourlyLimit = Math.floor(baseHourlyLimit * patternMultiplier);
  const adjustedDailyLimit = Math.floor(baseDailyLimit * patternMultiplier);

  return {
    canSend: messagesInLastHour < adjustedHourlyLimit && messagesInLastDay < adjustedDailyLimit,
    hourlyRemaining: adjustedHourlyLimit - messagesInLastHour,
    dailyRemaining: adjustedDailyLimit - messagesInLastDay,
    hourlyLimit: adjustedHourlyLimit,
    dailyLimit: adjustedDailyLimit,
    patternMultiplier
  };
}

module.exports = {
  getBusinessHourlyLimit
};
