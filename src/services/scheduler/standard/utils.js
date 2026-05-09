/**
 * Utilidades de tiempo y comportamiento humano para el scheduler estándar
 */

/**
 * Genera delay con distribución sesgada (no uniforme) para comportamiento más humano
 */
function getHumanLikeDelay(minMs, maxMs) {
  const range = maxMs - minMs;
  const skewedRandom = Math.pow(Math.random(), 2);
  return minMs + skewedRandom * range;
}

/**
 * Verifica si es horario laboral en Colombia (7:00 AM - 11:00 PM)
 */
function isBusinessHours() {
  const now = new Date();
  const colombiaOffset = -5 * 60 * 60 * 1000;
  const colombiaTime = new Date(now.getTime() + colombiaOffset);
  const hour = colombiaTime.getUTCHours();
  return hour >= 7 && hour < 23;
}

/**
 * Ajusta una fecha programada para que caiga dentro del horario laboral
 */
function adjustToBusinessHours(date) {
  const colombiaOffset = -5 * 60 * 60 * 1000;
  const colombiaTime = new Date(date.getTime() + colombiaOffset);
  const hourInColombia = colombiaTime.getUTCHours();
  const adjusted = new Date(date);

  if (hourInColombia < 7) {
    const targetUTC = new Date(colombiaTime);
    targetUTC.setUTCHours(12, 0, 0, 0);
    adjusted.setTime(targetUTC.getTime() - colombiaOffset);
    console.log(`[Scheduler] ⏰ Hora ajustada de ${hourInColombia}:00 a 7:00 AM (inicio horario laboral)`);
  } else if (hourInColombia >= 23) {
    const targetUTC = new Date(colombiaTime);
    targetUTC.setUTCDate(targetUTC.getUTCDate() + 1);
    targetUTC.setUTCHours(12, 0, 0, 0);
    adjusted.setTime(targetUTC.getTime() - colombiaOffset);
    console.log(`[Scheduler] ⏰ Hora ajustada de ${hourInColombia}:00 a 7:00 AM del día siguiente`);
  }

  return adjusted;
}

module.exports = {
  getHumanLikeDelay,
  isBusinessHours,
  adjustToBusinessHours
};
