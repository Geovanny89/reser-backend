const express = require('express');
const router = express.Router();
const socketController = require('../controllers/socket.controller');
const authenticate = require('../middleware/auth');

// Todas las rutas requieren autenticación
router.use(authenticate);

// GET /api/socket/stats - Estadísticas de conexiones
router.get('/stats', socketController.getStats);

// GET /api/socket/health - Estado de Socket.io
router.get('/health', socketController.health);

// POST /api/socket/broadcast - Enviar broadcast (solo admin)
router.post('/broadcast', socketController.broadcast);

// POST /api/socket/notify-employee - Notificar empleado específico
router.post('/notify-employee', socketController.notifyEmployee);

module.exports = router;
