/**
 * Utilidades de tiempo y zona horaria (Colombia UTC-5)
 */

/**
 * Verifica si es horario laboral en Colombia (7:00 AM - 11:00 PM)
 * Colombia es UTC-5 (todo el año, no tiene horario de verano)
 */
function isBusinessHours() {
  const options = { timeZone: 'America/Bogota', hour12: false, hour: '2-digit' };
  const hourStr = new Date().toLocaleString('en-US', options);
  const hour = parseInt(hourStr.split(' ')[0], 10);
  return hour >= 7 && hour < 23;
}

/**
 * Ajusta una fecha programada para que caiga dentro del horario laboral
 * Si es antes de las 7:00 AM, programa a las 7:00 AM del mismo día
 * Si es después de las 11:00 PM, programa a las 7:00 AM del día siguiente
 */
function adjustToBusinessHours(date) {
  const options = {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  };
  const dateParts = date.toLocaleString('en-US', options).replace(',', '').split(/[\/:\s]/);
  const [month, day, year, hour, minute, second] = dateParts.map(Number);
  
  let finalYear = year;
  let finalMonth = month;
  let finalDay = day;
  let finalHour = hour;
  let finalMinute = minute;
  let finalSecond = second;
  let needsAdjustment = false;
  let adjustMessage = '';
  
  if (hour < 7) {
    finalHour = 7;
    finalMinute = 0;
    finalSecond = 0;
    needsAdjustment = true;
    adjustMessage = `[Scheduler] ⏰ Hora ajustada de ${hour}:00 a 7:00 AM (inicio horario laboral)`;
  } else if (hour >= 23) {
    // Añadir un día
    const tempDate = new Date(year, month - 1, day);
    tempDate.setDate(tempDate.getDate() + 1);
    finalYear = tempDate.getFullYear();
    finalMonth = tempDate.getMonth() + 1; // porque getMonth() devuelve 0-11
    finalDay = tempDate.getDate();
    finalHour = 7;
    finalMinute = 0;
    finalSecond = 0;
    needsAdjustment = true;
    adjustMessage = `[Scheduler] ⏰ Hora ajustada de ${hour}:00 a 7:00 AM del día siguiente`;
  }
  
  if (needsAdjustment) {
    const finalStr = `${finalYear}-${String(finalMonth).padStart(2, '0')}-${String(finalDay).padStart(2, '0')}T${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}:${String(finalSecond).padStart(2, '0')}-05:00`;
    const finalDate = new Date(finalStr);
    console.log(adjustMessage);
    return finalDate;
  }
  
  return date;
}

/**
 * Obtiene la hora actual en Colombia para logs
 */
function getColombiaTimeISO() {
  const now = new Date();
  const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const dateParts = now.toLocaleString('en-US', options).replace(',', '').split(/[\/:\s]/);
  const [month, day, year, hour, minute, second] = dateParts.map(Number);
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
};
