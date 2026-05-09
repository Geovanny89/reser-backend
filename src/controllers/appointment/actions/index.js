/**
 * Módulo de Acciones de Citas - Punto de entrada modularizado
 */

const createActions = require('./create');
const updateStatusActions = require('./updateStatus');
const updateDetailsActions = require('./updateDetails');
const notificationActions = require('./notifications');
const cashRegisterActions = require('./cashRegister');

module.exports = {
  ...createActions,
  ...updateStatusActions,
  ...updateDetailsActions,
  ...notificationActions,
  ...cashRegisterActions
};
