/**
 * Configuración de recordatorios
 */
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

const REMINDER_CONFIG = {
  '24h': { ms: 24 * MS_PER_HOUR, field: 'reminder24hSent', windowMinutes: 10, confirmation: true },
  '12h': { ms: 12 * MS_PER_HOUR, field: 'reminder12hSent', windowMinutes: 10, confirmation: true },
  '2h': { ms: 2 * MS_PER_HOUR, field: 'reminder2hSent', windowMinutes: 10, confirmation: true },
  '1h': { ms: 1 * MS_PER_HOUR, field: 'reminderSent', windowMinutes: 5, confirmation: false },
  '30m': { ms: 30 * MS_PER_MINUTE, field: 'reminder30mSent', windowMinutes: 5, confirmation: false },
  '15m': { ms: 15 * MS_PER_MINUTE, field: 'reminder15mSent', windowMinutes: 2, confirmation: false },
  // Técnicos de campo
  'tech60m': { ms: 60 * MS_PER_MINUTE, field: 'pendingAlert60mSent', windowMinutes: 5, technicianOnly: true },
  'tech30m': { ms: 30 * MS_PER_MINUTE, field: 'pendingAlert30mSent', windowMinutes: 5, technicianOnly: true },
  'tech15m': { ms: 15 * MS_PER_MINUTE, field: 'pendingAlertSent', windowMinutes: 5, technicianOnly: true },
};

const REFERENCE_CONFIG = { windowMinutes: 2, field: 'referenceMessageSent' };
const CHECK_INTERVAL_MS = MS_PER_MINUTE;
const COLOMBIA_TIME_OPTIONS = { timeZone: 'America/Bogota' };

module.exports = {
  REMINDER_CONFIG,
  REFERENCE_CONFIG,
  CHECK_INTERVAL_MS,
  COLOMBIA_TIME_OPTIONS,
  MS_PER_MINUTE,
  MS_PER_HOUR,
};
