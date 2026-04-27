/**
 * Configuración de Socket.io
 */
const socketConfig = {
  cors: {
  origin: [
    "https://reservas.k-dice.com",
    "https://api-reservas.k-dice.com",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000"
  ],
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
