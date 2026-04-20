const { getIO, getConnectionStats } = require('../services/socketService');

/**
 * Controlador para endpoints HTTP de Socket.io
 * Permite consultar estado y estadísticas de las conexiones
 */

/**
 * GET /api/socket/stats
 * Obtiene estadísticas de conexiones activas
 */
exports.getStats = async (req, res) => {
  try {
    const stats = getConnectionStats();
    res.json({
      success: true,
      stats: {
        connections: {
          total: stats.total,
          byBusiness: stats.byBusiness,
          byRole: stats.byRole
        },
        memory: {
          heapUsed: Math.round(stats.memoryUsage.heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(stats.memoryUsage.heapTotal / 1024 / 1024) + ' MB',
          external: Math.round(stats.memoryUsage.external / 1024 / 1024) + ' MB'
        }
      }
    });
  } catch (error) {
    console.error('[SocketController] Error obteniendo stats:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
};

/**
 * POST /api/socket/broadcast
 * Envía un mensaje broadcast a un negocio (solo admin)
 */
exports.broadcast = async (req, res) => {
  try {
    const { businessId, event, data } = req.body;
    
    if (!businessId || !event) {
      return res.status(400).json({ error: 'businessId y event son requeridos' });
    }

    const io = getIO();
    if (!io) {
      return res.status(503).json({ error: 'Socket.io no está inicializado' });
    }

    io.to(`business:${businessId}`).emit(event, data);
    
    res.json({
      success: true,
      message: `Evento ${event} enviado a business:${businessId}`
    });
  } catch (error) {
    console.error('[SocketController] Error en broadcast:', error);
    res.status(500).json({ error: 'Error enviando broadcast' });
  }
};

/**
 * POST /api/socket/notify-employee
 * Notifica específicamente a un empleado
 */
exports.notifyEmployee = async (req, res) => {
  try {
    const { employeeId, event, data } = req.body;
    
    if (!employeeId || !event) {
      return res.status(400).json({ error: 'employeeId y event son requeridos' });
    }

    const io = getIO();
    if (!io) {
      return res.status(503).json({ error: 'Socket.io no está inicializado' });
    }

    io.to(`employee:${employeeId}`).emit(event, data);
    
    res.json({
      success: true,
      message: `Evento ${event} enviado a employee:${employeeId}`
    });
  } catch (error) {
    console.error('[SocketController] Error notificando empleado:', error);
    res.status(500).json({ error: 'Error notificando empleado' });
  }
};

/**
 * GET /api/socket/health
 * Verifica el estado de Socket.io
 */
exports.health = async (req, res) => {
  try {
    const io = getIO();
    const stats = getConnectionStats();
    
    res.json({
      success: true,
      status: io ? 'active' : 'inactive',
      connections: stats.total,
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('[SocketController] Error en health check:', error);
    res.status(500).json({ error: 'Error verificando estado' });
  }
};
