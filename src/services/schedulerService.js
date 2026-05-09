/**
 * Servicio de Programación de Mensajes (Scheduler Service)
 * Modularizado para mejor mantenimiento.
 */

const standardScheduler = require('./scheduler/standard/index');

module.exports = {
  ...standardScheduler
};
