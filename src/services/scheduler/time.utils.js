/**
 * Utilidades de tiempo y zona horaria (Colombia UTC-5)
 */

const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * Verifica si es horario laboral en Colombia (7:00 AM - 11:00 PM)
 * Colombia es UTC-5 (todo el año, no tiene horario de verano)
 */
function isBusinessHours() {
  const now = new Date();
  const colombiaTime = new Date(now.getTime() + COLOMBIA_OFFSET_MS);
  const hour = colombiaTime.getUTCHours();
  return hour >= 7 && hour < 23;
}

/**
 * Ajusta una fecha programada para que caiga dentro del horario laboral
 * Si es antes de las 7:00 AM, programa a las 7:00 AM del mismo día
 * Si es después de las 11:00 PM, programa a las 7:00 AM del día siguiente
 */
function adjustToBusinessHours(date) {
  const colombiaTime = new Date(date.getTime() + COLOMBIA_OFFSET_MS);
  const hourInColombia = colombiaTime.getUTCHours();
  const adjusted = new Date(date);

  if (hourInColombia < 7) {
    const targetUTC = new Date(colombiaTime);
    targetUTC.setUTCHours(12, 0, 0, 0);
    adjusted.setTime(targetUTC.getTime() - COLOMBIA_OFFSET_MS);
    console.log(`[Scheduler] ⏰ Hora ajustada de ${hourInColombia}:00 a 7:00 AM (inicio horario laboral)`);
  } else if (hourInColombia >= 23) {
    const targetUTC = new Date(colombiaTime);
    targetUTC.setUTCDate(targetUTC.getUTCDate() + 1);
    targetUTC.setUTCHours(12, 0, 0, 0);
    adjusted.setTime(targetUTC.getTime() - COLOMBIA_OFFSET_MS);
    console.log(`[Scheduler] ⏰ Hora ajustada de ${hourInColombia}:00 a 7:00 AM del día siguiente`);
  }

  return adjusted;
}

/**
 * Obtiene la hora actual en Colombia para logs
 */
function getColombiaTimeISO() {
  const now = new Date();
  // Convertir la fecha actual a zona horaria de Colombia
  const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const dateParts = now.toLocaleString('en-US', options).replace(',', '').split(/[\/:\s]/);
  const [month, day, year, hour, minute, second] = dateParts.map(Number);
  // Crear fecha con offset de Colombia explícito
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}-05:00`;
}

/**
 * Obtiene la hora UTC actual en formato ISO
 */
function getUTCTimeISO() {
  return new Date().toISOString();
}

module.exports = {
  isBusinessHours,
  adjustToBusinessHours,
  getColombiaTimeISO,
  getUTCTimeISO,
  COLOMBIA_OFFSET_MS,
};
