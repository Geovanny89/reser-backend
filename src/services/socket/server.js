/**
 * Servidor Socket.io - Inicialización
 */
const { Server } = require('socket.io');
const { socketConfig } = require('./config');
const { socketAuthMiddleware } = require('./auth.middleware');
const { handleConnection } = require('./connection.handler');

let io = null;

/**
 * Inicializa Socket.io con configuración optimizada para bajo consumo de memoria
 */
function initializeSocketServer(httpServer) {
  io = new Server(httpServer, socketConfig);

  // Middleware de autenticación
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    handleConnection(socket);
  });

  console.log('🔌 Socket.io inicializado');
  return io;
}

/**
 * Obtiene la instancia de io
 */
function getIO() {
  return io;
}

module.exports = {
  initializeSocketServer,
  getIO,
};
