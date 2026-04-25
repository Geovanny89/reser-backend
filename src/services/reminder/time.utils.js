/**
 * Utilidades de tiempo para recordatorios
 */
const { COLOMBIA_TIME_OPTIONS } = require('./config');

function getRelativeDayText(date, timeStr) {
  const now = new Date();
  const colombiaNow = new Date(now.toLocaleString('en-US', COLOMBIA_TIME_OPTIONS));
  const colombiaDate = new Date(date.toLocaleString('en-US', COLOMBIA_TIME_OPTIONS));

  const today = new Date(colombiaNow.getFullYear(), colombiaNow.getMonth(), colombiaNow.getDate());
  const appointmentDay = new Date(colombiaDate.getFullYear(), colombiaDate.getMonth(), colombiaDate.getDate());

  const diffDays = (appointmentDay - today) / (24 * 60 * 60 * 1000);

  if (diffDays === 0) return `hoy a las *${timeStr}*`;
  if (diffDays === 1) return `mañana a las *${timeStr}*`;
  return `el ${appointmentDay.toLocaleDateString('es-CO')} a las *${timeStr}*`;
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString('es-CO', { timeStyle: 'short', ...COLOMBIA_TIME_OPTIONS });
}

function formatDateTime(date) {
  return new Date(date).toLocaleString('es-CO', { timeStyle: 'short', ...COLOMBIA_TIME_OPTIONS });
}

module.exports = {
  getRelativeDayText,
  formatTime,
  formatDateTime,
};
