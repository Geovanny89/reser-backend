/**
 * Configuración de Socket.io
 */
const socketConfig = {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Configuración para mínimo consumo de memoria
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  perMessageDeflate: {
    threshold: 1024,
    concurrencyLimit: 10,
  },
  maxHttpBufferSize: 1e6,
  connectTimeout: 45000,
};

module.exports = { socketConfig };
