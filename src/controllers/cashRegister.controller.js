/**
 * Controlador de Caja (Cash Register)
 * Modularizado para mejor mantenimiento.
 */

const cashRegister = require('./cashRegister/index');

module.exports = {
  ...cashRegister
};
