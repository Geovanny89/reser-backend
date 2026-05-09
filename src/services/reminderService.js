/**
 * Servicio de Recordatorios (Reminder Service)
 * Modularizado para mejor mantenimiento.
 */

const reminder = require('./reminder/index');

module.exports = {
  ...reminder
};
