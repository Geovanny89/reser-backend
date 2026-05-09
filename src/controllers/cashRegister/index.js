/**
 * Módulo de Controlador de Caja - Punto de entrada modularizado
 */

const shifts = require('./shifts');
const movements = require('./movements');
const excel = require('./excel');

module.exports = {
  ...shifts,
  ...movements,
  ...excel
};
