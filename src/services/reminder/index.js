/**
 * Reminder Service - Módulo modularizado
 *
 * Estructura:
 * - config.js: Configuración de tiempos y campos
 * - time.utils.js: Utilidades de tiempo (zona horaria Colombia)
 * - queries.js: Consultas a base de datos
 * - message.generators.js: Generadores de mensajes de WhatsApp
 * - notifications.js: Envío de notificaciones (push, email, WhatsApp)
 * - processors.js: Procesadores de cada tipo de recordatorio
 * - core.js: Ciclo principal sendReminders() y control del servicio
 */

const { startReminderService, stopReminderService } = require('./core');

module.exports = {
  startReminderService,
  stopReminderService,
};
