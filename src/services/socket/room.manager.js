/**
 * Gestión de salas (rooms) para sockets
 */

/**
 * Une un socket a las salas correspondientes según su rol
 */
function joinBusinessRooms(socket) {
  const { businessId, userRole, employeeId } = socket;

  console.log(`🔌 [RoomManager] Intentando unir a salas - socket: ${socket.id}, role: ${userRole}, employeeId: ${employeeId}, businessId: ${businessId}`);

  // Validar que tenemos businessId
  if (!businessId) {
    console.error(`🔌 [RoomManager] ERROR: Conexión sin businessId - socket ${socket.id}`);
    return false;
  }

  // Unirse a la sala del negocio (para notificaciones admin)
  socket.join(`business:${businessId}`);
  console.log(`🔌 [RoomManager] Unido a sala business:${businessId}`);

  // Si es empleado, unirse a sala personal
  if (userRole === 'employee' && employeeId) {
    socket.join(`employee:${employeeId}`);
    console.log(`🔌 [RoomManager] Unido a sala employee:${employeeId}`);
  } else {
    console.log(`🔌 [RoomManager] No se unió a sala employee - role: ${userRole}, employeeId: ${employeeId}`);
  }

  // Si es admin, unirse a sala admin del negocio
  if (userRole === 'admin' || userRole === 'admin_suc') {
    socket.join(`admin:${businessId}`);
    console.log(`🔌 [RoomManager] Unido a sala admin:${businessId}`);
  }

  // Listar todas las salas a las que se unió
  console.log(`🔌 [RoomManager] Socket ${socket.id} unido a salas:`, Array.from(socket.rooms));

  return true;
}

/**
 * Configura eventos de suscripción a citas
 */
function setupAppointmentSubscriptions(socket) {
  const { businessId } = socket;

  // Evento de suscripción a citas específicas
  socket.on('subscribe_appointments', (data) => {
    console.log(`🔌 [Socket] subscribe_appointments recibido:`, { socketId: socket.id, data, currentRooms: Array.from(socket.rooms) });
    if (data.employeeId) {
      socket.join(`employee_appointments:${data.employeeId}`);
      console.log(`🔌 [Socket] Unido a sala employee_appointments:${data.employeeId}`);
    }
    if (data.date) {
      socket.join(`date:${businessId}:${data.date}`);
      console.log(`🔌 [Socket] Unido a sala date:${businessId}:${data.date}`);
    }
  });

  // Evento de desuscripción
  socket.on('unsubscribe_appointments', (data) => {
    if (data.employeeId) {
      socket.leave(`employee_appointments:${data.employeeId}`);
    }
    if (data.date) {
      socket.leave(`date:${businessId}:${data.date}`);
    }
  });
}

module.exports = {
  joinBusinessRooms,
  setupAppointmentSubscriptions,
};
