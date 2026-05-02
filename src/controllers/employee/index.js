/**
 * Módulo de Empleados - Punto de entrada
 * 
 * Este módulo organiza la lógica de empleados en archivos separados:
 * - crud.js: Funciones básicas CRUD
 * - schedule.js: Agenda y calendario
 * - profile.js: Perfil e información
 * - services.js: Gestión de servicios
 * - commissions.js: Comisiones
 * - ratings.js: Calificaciones
 * - clients.js: Clientes frecuentes
 * - utils.js: Utilidades compartidas
 * 
 * La API se mantiene exactamente igual para compatibilidad.
 */

const crud = require('./crud');
const schedule = require('./schedule');
const profile = require('./profile');
const services = require('./services');
const commissions = require('./commissions');
const ratings = require('./ratings');
const clients = require('./clients');

module.exports = {
  // CRUD básico
  getByBusiness: crud.getByBusiness,
  create: crud.create,
  invite: crud.invite,
  update: crud.update,
  remove: crud.remove,
  resetPassword: crud.resetPassword,
  
  // Agenda
  getTodayAppointments: schedule.getTodayAppointments,
  getAppointmentsByDateRange: schedule.getAppointmentsByDateRange,
  
  // Perfil
  getEmployeeInfo: profile.getEmployeeInfo,
  updateMyProfile: profile.updateMyProfile,
  
  // Servicios
  getEmployeeServices: services.getEmployeeServices,
  setEmployeeServices: services.setEmployeeServices,
  addServiceToEmployee: services.addServiceToEmployee,
  removeServiceFromEmployee: services.removeServiceFromEmployee,
  getEmployeesByService: services.getEmployeesByService,
  
  // Comisiones
  getMyCommissions: commissions.getMyCommissions,
  getCommissionReport: commissions.getCommissionReport,
  
  // Calificaciones
  getMyRatings: ratings.getMyRatings,
  
  // Clientes
  getMyFrequentClients: clients.getMyFrequentClients
};
