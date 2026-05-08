/**
 * Utilidades para gestión de instancias
 * Archivo: evolution/instance.utils.js
 */

const KNOWN_COUNTRY_CODES = [
  { code: '57', length: 10, startsWith: '3' },  // Colombia
  { code: '58', length: 10, startsWith: '4' },  // Venezuela
  { code: '51', length: 9, startsWith: null },   // Perú
  { code: '52', length: 10, startsWith: null },  // México
  { code: '54', length: 10, startsWith: null },  // Argentina
  { code: '55', length: 11, startsWith: null },  // Brasil
  { code: '593', length: 9, startsWith: null },  // Ecuador
  { code: '506', length: 8, startsWith: null },  // Costa Rica
  { code: '1', length: 10, startsWith: null },   // EEUU/Canadá
];

function formatPhoneForEvolution(phone) {
  if (!phone) return '';
  let cleaned = String(phone).split('@')[0].replace(/\D/g, '');
  if (!cleaned) return '';

  if (cleaned.length > 11) return cleaned;

  if (cleaned.startsWith('0') && cleaned.length === 11) {
    return '58' + cleaned.substring(1);
  }

  if (cleaned.length === 10 && cleaned.startsWith('3')) {
    return '57' + cleaned;
  }

  for (const country of KNOWN_COUNTRY_CODES) {
    if (cleaned.length === country.length) {
      if (!country.startsWith || cleaned.startsWith(country.startsWith)) {
        return country.code + cleaned;
      }
    }
  }

  for (const country of KNOWN_COUNTRY_CODES) {
    if (cleaned.startsWith(country.code)) return cleaned;
  }

  return cleaned;
}

function extractPhoneFromInstance(instance) {
  const raw = instance.ownerJid || instance.owner || instance.number || instance.phone || '';
  if (!raw) return null;
  const cleaned = String(raw).split('@')[0].replace(/\D/g, '');
  return cleaned || null;
}

module.exports = {
  formatPhoneForEvolution,
  extractPhoneFromInstance
};
