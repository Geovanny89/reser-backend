/**
 * Utilidades generales para Evolution API
 * Archivo: evolution/utils.js
 */

function isBusinessHours() {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19;
}

function getDelayToNextBusinessHours() {
  const now = new Date();
  const tomorrow7am = new Date(now);
  tomorrow7am.setHours(7, 0, 0, 0);
  if (tomorrow7am <= now) {
    tomorrow7am.setDate(tomorrow7am.getDate() + 1);
  }
  return tomorrow7am - now;
}

function getRandomDelay() {
  return 2000 + Math.random() * 3000;
}

function cleanPhoneNumber(phone) {
  if (!phone) return '';
  return phone.replace(/[\s\-\(\)\+]/g, '');
}

function normalizeColombianNumber(phone) {
  if (!phone) return '';
  const cleaned = cleanPhoneNumber(phone);
  
  if (cleaned.startsWith('57')) {
    return cleaned.substring(2);
  }
  
  if (cleaned.length === 10) {
    return cleaned;
  }
  
  if (cleaned.length === 7) {
    return '3' + cleaned;
  }
  
  return cleaned;
}

module.exports = {
  isBusinessHours,
  getDelayToNextBusinessHours,
  getRandomDelay,
  cleanPhoneNumber,
  normalizeColombianNumber
};
