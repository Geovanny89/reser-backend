/**
 * Utilidades de fechas y zona horaria Colombia
 * Zona horaria Colombia: UTC-5 (no cambia con horario de verano)
 */

const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * Dado un string de fecha "YYYY-MM-DD", construye un objeto Date que representa
 * la medianoche en Colombia (UTC-5), sin importar la zona del servidor.
 */
function colombiaDateFromString(dateStr) {
  // dateStr = "2026-03-24"
  // Medianoche Colombia = 05:00 UTC del mismo día
  return new Date(dateStr + 'T00:00:00-05:00');
}

/**
 * Construye un Date UTC a partir de una fecha "YYYY-MM-DD" y hora "HH:MM"
 * interpretados en zona horaria Colombia (UTC-5).
 */
function colombiaDateTimeToUTC(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00-05:00`);
}

/**
 * Obtiene el día de la semana en Colombia para una fecha dada.
 * 0=Domingo, 1=Lunes, ..., 6=Sábado
 */
function getDayOfWeekColombia(dateStr) {
  const d = colombiaDateFromString(dateStr);
  // Ajustamos al offset de Colombia para obtener el día local
  const localMs = d.getTime() + COLOMBIA_OFFSET_MS;
  const localDate = new Date(localMs);
  return localDate.getUTCDay();
}

/**
 * Formatea una fecha para mostrar en notificaciones
 */
function formatDateColombia(date) {
  return new Date(date).toLocaleDateString('es-CO', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Bogota'
  });
}

/**
 * Formatea una hora para mostrar en notificaciones
 */
function formatTimeColombia(date) {
  return new Date(date).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota'
  });
}

/**
 * Obtiene la hora actual en Colombia como un objeto Date.
 * Útil para comparaciones de "ya pasó" sin depender de la hora del servidor.
 */
function getNowColombia() {
  // Obtenemos la hora UTC actual
  const now = new Date();
  // Aplicamos el desfase de Colombia (-5h) para obtener la representación local
  // Nota: Esto devuelve un objeto Date cuya representación UTC es en realidad la hora de Colombia
  return new Date(now.getTime());
}

/**
 * Obtiene la fecha actual en Colombia en formato YYYY-MM-DD
 */
function getTodayStringColombia() {
  const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); // en-CA da formato YYYY-MM-DD
  return formatter.format(new Date());
}

module.exports = {
  COLOMBIA_OFFSET_MS,
  colombiaDateFromString,
  colombiaDateTimeToUTC,
  getDayOfWeekColombia,
  formatDateColombia,
  formatTimeColombia,
  getNowColombia,
  getTodayStringColombia
};
