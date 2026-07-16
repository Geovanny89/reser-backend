/**
 * Utilidades de tiempo para recordatorios
 */
const { COLOMBIA_TIME_OPTIONS } = require('./config');

function getRelativeDayText(date, timeStr) {
  const now = new Date();
  
  const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
  const dateBogota = date.toLocaleDateString('es-CO', options);
  const nowBogota = now.toLocaleDateString('es-CO', options);
  
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowBogota = tomorrow.toLocaleDateString('es-CO', options);

  if (dateBogota === nowBogota) return `hoy a las *${timeStr}*`;
  if (dateBogota === tomorrowBogota) return `mañana a las *${timeStr}*`;
  
  return `el ${date.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })} a las *${timeStr}*`;
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
