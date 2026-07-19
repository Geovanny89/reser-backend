/**
 * Utilidades de tiempo para recordatorios
 */
const { COLOMBIA_TIME_OPTIONS } = require('./config');

/**
 * Obtiene la fecha y hora actual en zona horaria de Colombia como objeto Date
 * (usa el mismo patrón que en el resto del códigobase, compatible con Sequelize)
 */
function getNowInColombia() {
  const now = new Date();
  const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const dateParts = now.toLocaleString('en-US', options).replace(',', '').split(/[\/:\s]/);
  const [month, day, year, hour, minute, second] = dateParts.map(Number);
  // Crear la fecha en Colombia como string con offset explícito para evitar confusiones de zona
  const colombiaDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}-05:00`;
  return new Date(colombiaDateStr);
}

function getRelativeDayText(date, timeStr) {
  // Obtener la fecha actual y la fecha de la cita en la zona horaria de Colombia como componentes (year/month/day)
  const nowComponents = toColombiaDateComponents(new Date());
  const appointmentComponents = toColombiaDateComponents(date);

  // Construir fechas en Colombia sin UTC para comparar solo la fecha
  const nowDate = new Date(nowComponents.year, nowComponents.month - 1, nowComponents.day);
  const appointmentDate = new Date(appointmentComponents.year, appointmentComponents.month - 1, appointmentComponents.day);
  const tomorrowDate = new Date(nowDate);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);

  if (appointmentDate.getTime() === nowDate.getTime()) {
    return `hoy a las *${timeStr}*`;
  }
  if (appointmentDate.getTime() === tomorrowDate.getTime()) {
    return `mañana a las *${timeStr}*`;
  }
  
  return `el ${date.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })} a las *${timeStr}*`;
}

/**
 * Función auxiliar para extraer los componentes de fecha de una fecha en zona horaria de Colombia
 */
function toColombiaDateComponents(inputDate) {
  const options = {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false
  };
  const dateParts = inputDate.toLocaleString('en-US', options).replace(',', '').split(/[\/:\s]/);
  const [month, day, year] = dateParts.map(Number);
  return { year, month, day };
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
  getNowInColombia,
  toColombiaDateComponents,
};
