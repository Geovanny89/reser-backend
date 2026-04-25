/**
 * Middleware de autenticación para Socket.io
 */
async function socketAuthMiddleware(socket, next) {
  try {
    const { token, businessId, userId, role } = socket.handshake.auth;

    if (!businessId) {
      return next(new Error('businessId requerido'));
    }

    // Guardar datos de usuario en el socket
    socket.userId = userId;
    socket.businessId = businessId;
    socket.userRole = role || 'client';
    socket.employeeId = socket.handshake.auth.employeeId || null;

    next();
  } catch (err) {
    next(new Error('Autenticación fallida'));
  }
}

module.exports = { socketAuthMiddleware };
