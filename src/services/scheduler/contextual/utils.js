/**
 * Utilidades de tiempo y jitter para el scheduler contextual
 */

const { CONTEXTUAL_CONFIG } = require('./config');

/**
 * Calcula jitter persistente por cita usando hash del ID
 */
function getPersistentJitter(appointmentId, windowSizeMs) {
  let hash = 0;
  const idStr = appointmentId.toString();
  for (let i = 0; i < idStr.length; i++) {
    const char = idStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const normalizedHash = Math.abs(hash) / 2147483647;
  return normalizedHash * windowSizeMs;
}

/**
 * Calcula el momento óptimo para enviar un mensaje basado en la cita
 */
function calculateOptimalSendTime(appointment, messageType) {
  const now = Date.now();
  const appointmentTime = new Date(appointment.startTime).getTime();
  const timeUntilAppointment = appointmentTime - now;

  if (timeUntilAppointment < 0) return null;

  const window = CONTEXTUAL_CONFIG.REMINDER_WINDOWS[messageType];
  if (!window) return Math.random() * 60 * 60 * 1000;

  const windowWidth = window.before - window.after;
  const jitter = getPersistentJitter(appointment.id, windowWidth);
  const targetTimeFromAppointment = window.after + jitter;
  const targetAbsoluteTime = appointmentTime - targetTimeFromAppointment;

  if (now < targetAbsoluteTime) return targetAbsoluteTime - now;

  if (timeUntilAppointment <= window.before && timeUntilAppointment >= window.after) {
    return Math.random() * 5 * 60 * 1000;
  }

  return Math.random() * 2 * 60 * 1000;
}

/**
 * Obtiene texto relativo del día (hoy, mañana, etc.)
 */
function getRelativeDayText(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (date.toDateString() === now.toDateString()) {
    return 'hoy';
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return 'mañana';
  } else {
    return date.toLocaleDateString('es-CO', { weekday: 'long' });
  }
}

module.exports = {
  calculateOptimalSendTime,
  getRelativeDayText
};
