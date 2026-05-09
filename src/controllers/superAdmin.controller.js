/**
 * Controlador de SuperAdmin - Proxy
 * Modularizado para mejor mantenimiento.
 */

const superAdmin = require('./superAdmin/index');

module.exports = {
  ...superAdmin
};
