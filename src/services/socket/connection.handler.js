/**
 * Manejador de conexiones de socket
 */
const { updateConnectionStats } = require('./connection.manager');
const { joinBusinessRooms, setupAppointmentSubscriptions } = require('./room.manager');

/**
 * Maneja una nueva conexión
 */
function handleConnection(socket) {
  const { businessId, userId, userRole, employeeId } = socket;

  console.log(`🔌 [Socket] Nueva conexión:`, {
    socketId: socket.id,
    businessId,
    userId,
    userRole,
    employeeId,
  });

  // Unirse a salas según rol
  const joined = joinBusinessRooms(socket);
  if (!joined) return;

  // Actualizar estadísticas
  updateConnectionStats('add', businessId, userRole);

  console.log(`🔌 [Socket] ${userRole} conectado - Business: ${businessId}${employeeId ? `, Employee: ${employeeId}` : ''}`);

  // Evento de desconexión
  socket.on('disconnect', (reason) => {
    updateConnectionStats('remove', businessId, userRole);
    console.log(`🔌 [Socket] ${userRole} desconectado (${reason}) - Business: ${businessId}`);
  });

  // Configurar suscripciones a citas
  setupAppointmentSubscriptions(socket);
}

module.exports = { handleConnection };
