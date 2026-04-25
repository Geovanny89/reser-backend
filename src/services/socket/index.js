/**
 * Socket Service - Módulo modularizado
 *
 * Estructura:
 * - server.js: Inicialización del servidor Socket.io
 * - config.js: Configuración
 * - auth.middleware.js: Autenticación de sockets
 * - connection.manager.js: Estadísticas de conexión
 * - connection.handler.js: Manejo de conexiones entrantes
 * - room.manager.js: Gestión de salas
 * - appointment.emitter.js: Emisores de eventos de citas
 * - service.emitter.js: Emisores de eventos de servicios
 */

const { initializeSocketServer, getIO } = require('./server');
const { createAppointmentEmitters } = require('./appointment.emitter');
const { createServiceEmitters } = require('./service.emitter');
const { getConnectionStats } = require('./connection.manager');

// Crear emisores vinculados a la instancia de io
let appointmentEmitters = null;
let serviceEmitters = null;

function getAppointmentEmitters() {
  if (!appointmentEmitters) {
    const io = getIO();
    if (!io) return null;
    appointmentEmitters = createAppointmentEmitters(io);
  }
  return appointmentEmitters;
}

function getServiceEmitters() {
  if (!serviceEmitters) {
    const io = getIO();
    if (!io) return null;
    serviceEmitters = createServiceEmitters(io);
  }
  return serviceEmitters;
}

// API pública con compatibilidad hacia atrás
module.exports = {
  initializeSocketServer,
  getIO,
  getConnectionStats,

  // Emisores de citas (con lazy initialization)
  emitNewAppointment: async (...args) => getAppointmentEmitters()?.emitNewAppointment(...args),
  emitAppointmentUpdate: async (...args) => getAppointmentEmitters()?.emitAppointmentUpdate(...args),
  emitAppointmentCancelled: async (...args) => getAppointmentEmitters()?.emitAppointmentCancelled(...args),

  // Emisores de servicios (con lazy initialization)
  emitServiceCreated: async (...args) => getServiceEmitters()?.emitServiceCreated(...args),
  emitServiceUpdated: async (...args) => getServiceEmitters()?.emitServiceUpdated(...args),
  emitServiceDeleted: async (...args) => getServiceEmitters()?.emitServiceDeleted(...args),
};
