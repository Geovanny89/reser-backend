/**
 * Scheduler Service - Módulo modularizado
 *
 * Estructura:
 * - config.js: Constantes y estado de procesamiento
 * - time.utils.js: Utilidades de tiempo (Colombia UTC-5)
 * - message.queries.js: Consultas a base de datos
 * - business.processor.js: Procesamiento de mensajes por negocio
 * - incoming.processor.js: Procesamiento de mensajes entrantes
 * - core.js: Función principal runScheduler()
 * - api.js: API pública (scheduleMessage, cancel, stats)
 */

const { runScheduler } = require('./core');
const { scheduleMessage, cancelAppointmentMessages, getStats } = require('./api');
const { isBusinessHours } = require('./time.utils');

module.exports = {
  runScheduler,
  scheduleMessage,
  cancelAppointmentMessages,
  getStats,
  isBusinessHours,
};
