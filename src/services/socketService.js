const { Server } = require('socket.io');
const { Appointment, Service, Employee, User, Business } = require('../models');

let io = null;

// Mapa de conexiones activas para monitoreo de memoria
const connectionStats = {
  total: 0,
  byBusiness: new Map(),
  byRole: new Map()
};

/**
 * Inicializa Socket.io con configuración optimizada para bajo consumo de memoria
 */
function initializeSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*', // Temporal: permitir cualquier origen para debuggear
      methods: ['GET', 'POST'],
      credentials: true
    },
    // Configuración para mínimo consumo de memoria y soportar 200+ usuarios
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'], // WebSocket primero, fallback a polling
    allowUpgrades: true,
    perMessageDeflate: {
      threshold: 1024, // Comprimir mensajes > 1KB
      concurrencyLimit: 10
    },
    maxHttpBufferSize: 1e6, // 1MB max
    connectTimeout: 45000,
    // Límites para 200 usuarios (50 por instancia × 4 instancias)
    maxHttpBufferSize: 1e6,
  });

  // Middleware de autenticación
  io.use(async (socket, next) => {
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
  });

  io.on('connection', (socket) => {
    handleConnection(socket);
  });

  console.log('🔌 Socket.io inicializado');
  return io;
}

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
    employeeId
  });
  
  // Validar que tenemos businessId
  if (!businessId) {
    console.error(`🔌 [Socket] ERROR: Conexión sin businessId - socket ${socket.id}`);
    return;
  }
  
  // Unirse a la sala del negocio (para notificaciones admin)
  socket.join(`business:${businessId}`);
  console.log(`🔌 [Socket] Unido a sala business:${businessId}`);
  
  // Si es empleado, unirse a sala personal
  if (userRole === 'employee' && employeeId) {
    socket.join(`employee:${employeeId}`);
    console.log(`🔌 [Socket] Unido a sala employee:${employeeId}`);
  }
  
  // Si es admin, unirse a sala admin del negocio
  if (userRole === 'admin' || userRole === 'admin_suc') {
    socket.join(`admin:${businessId}`);
    console.log(`🔌 [Socket] Unido a sala admin:${businessId}`);
  }
  
  // Actualizar estadísticas
  updateConnectionStats('add', businessId, userRole);
  
  console.log(`🔌 [Socket] ${userRole} conectado - Business: ${businessId}${employeeId ? `, Employee: ${employeeId}` : ''}`);

  // Evento de desconexión
  socket.on('disconnect', (reason) => {
    updateConnectionStats('remove', businessId, userRole);
    console.log(`🔌 [Socket] ${userRole} desconectado (${reason}) - Business: ${businessId}`);
  });

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

/**
 * Actualiza estadísticas de conexión
 */
function updateConnectionStats(action, businessId, role) {
  if (action === 'add') {
    connectionStats.total++;
    connectionStats.byBusiness.set(businessId, 
      (connectionStats.byBusiness.get(businessId) || 0) + 1
    );
    connectionStats.byRole.set(role, 
      (connectionStats.byRole.get(role) || 0) + 1
    );
  } else {
    connectionStats.total = Math.max(0, connectionStats.total - 1);
    const bizCount = connectionStats.byBusiness.get(businessId) || 0;
    if (bizCount > 1) {
      connectionStats.byBusiness.set(businessId, bizCount - 1);
    } else {
      connectionStats.byBusiness.delete(businessId);
    }
    const roleCount = connectionStats.byRole.get(role) || 0;
    if (roleCount > 1) {
      connectionStats.byRole.set(role, roleCount - 1);
    } else {
      connectionStats.byRole.delete(role);
    }
  }
}

/**
 * Emite una nueva cita a los destinatarios relevantes
 */
async function emitNewAppointment(appointment, options = {}) {
  if (!io) return;

  const { notifyEmployee = true, notifyAdmin = true } = options;
  const apptData = await formatAppointmentData(appointment);

  // DEBUG: Verificar businessId
  console.log(`📢 [Socket] Emitiendo cita ${appointment.id}:`, {
    businessId: appointment.businessId,
    businessIdType: typeof appointment.businessId,
    employeeId: appointment.employeeId
  });

  // Emitir a admins del negocio
  if (notifyAdmin) {
    const targetRooms = [`business:${appointment.businessId}`, `admin:${appointment.businessId}`];
    console.log(`📢 [Socket] Emitiendo appointment:created a salas:`, targetRooms);
    io.to(`business:${appointment.businessId}`)
      .to(`admin:${appointment.businessId}`)
      .emit('appointment:created', apptData);
  }

  // Emitir al empleado principal asignado
  if (notifyEmployee && appointment.employeeId) {
    const targetRoom = `employee:${appointment.employeeId}`;
    const targetRoom2 = `employee_appointments:${appointment.employeeId}`;
    console.log(`📢 [Socket] Emitiendo appointment:new_assigned a salas:`, [targetRoom, targetRoom2]);
    console.log(`📢 [Socket] Cita employeeId: ${appointment.employeeId}`);
    
    // Verificar cuántos sockets están en cada sala
    const room1Sockets = io.sockets.adapter.rooms.get(`employee:${appointment.employeeId}`)?.size || 0;
    const room2Sockets = io.sockets.adapter.rooms.get(`employee_appointments:${appointment.employeeId}`)?.size || 0;
    console.log(`📢 [Socket] Clientes en sala ${targetRoom}: ${room1Sockets}, en ${targetRoom2}: ${room2Sockets}`);
    
    io.to(targetRoom)
      .to(targetRoom2)
      .emit('appointment:new_assigned', apptData);
    
    console.log(`📢 [Socket] Cita ${appointment.id} notificada a empleado ${appointment.employeeId}`);
  } else {
    console.log(`📢 [Socket] No se emitió a empleado - notifyEmployee: ${notifyEmployee}, employeeId: ${appointment.employeeId}`);
  }

  // Emitir a empleados adicionales (citas grupales)
  if (appointment.AdditionalEmployees?.length > 0) {
    for (const addEmp of appointment.AdditionalEmployees) {
      io.to(`employee:${addEmp.employeeId}`)
        .to(`employee_appointments:${addEmp.employeeId}`)
        .emit('appointment:new_assigned', {
          ...apptData,
          isAdditionalEmployee: true
        });
    }
  }

  // Notificar por fecha específica
  if (appointment.startTime) {
    const dateStr = new Date(appointment.startTime).toISOString().split('T')[0];
    io.to(`date:${appointment.businessId}:${dateStr}`)
      .emit('appointment:date_update', {
        date: dateStr,
        appointmentId: appointment.id,
        action: 'created'
      });
  }
}

/**
 * Emite actualización de estado de cita
 */
async function emitAppointmentUpdate(appointment, updateType = 'updated') {
  if (!io) return;

  const apptData = await formatAppointmentData(appointment);

  // Emitir a todos en el negocio y a la sala de admins
  io.to(`business:${appointment.businessId}`)
    .to(`admin:${appointment.businessId}`)
    .emit(`appointment:${updateType}`, apptData);

  // Emitir específicamente al empleado asignado
  if (appointment.employeeId) {
    io.to(`employee:${appointment.employeeId}`)
      .emit(`appointment:${updateType}`, apptData);
  }

  // Notificar cambio en fecha
  if (appointment.startTime) {
    const dateStr = new Date(appointment.startTime).toISOString().split('T')[0];
    io.to(`date:${appointment.businessId}:${dateStr}`)
      .emit('appointment:date_update', {
        date: dateStr,
        appointmentId: appointment.id,
        action: updateType
      });
  }
}

/**
 * Emite cancelación de cita
 */
async function emitAppointmentCancelled(appointment, cancelledBy) {
  if (!io) return;

  const apptData = await formatAppointmentData(appointment);

  io.to(`business:${appointment.businessId}`)
    .to(`employee:${appointment.employeeId}`)
    .emit('appointment:cancelled', {
      ...apptData,
      cancelledBy: cancelledBy || 'system'
    });
}

/**
 * Formatea los datos de la cita para envío
 */
async function formatAppointmentData(appointment) {
  // Si ya viene populada, usar directamente
  if (appointment.Service || appointment.Employee) {
    return {
      id: appointment.id,
      businessId: appointment.businessId,
      serviceId: appointment.serviceId,
      employeeId: appointment.employeeId,
      clientName: appointment.clientName,
      clientPhone: appointment.clientPhone,
      clientEmail: appointment.clientEmail,
      clientId: appointment.clientId,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      status: appointment.status,
      notes: appointment.notes,
      basePrice: appointment.basePrice,
      finalPrice: appointment.finalPrice,
      technicianStatus: appointment.technicianStatus,
      travelStartTime: appointment.travelStartTime,
      arrivalTime: appointment.arrivalTime,
      serviceStartTime: appointment.serviceStartTime,
      Service: appointment.Service ? {
        id: appointment.Service.id,
        name: appointment.Service.name,
        durationMin: appointment.Service.durationMin,
        price: appointment.Service.price
      } : null,
      Employee: appointment.Employee ? {
        id: appointment.Employee.id,
        User: appointment.Employee.User ? {
          name: appointment.Employee.User.name
        } : null
      } : null,
      AdditionalEmployees: appointment.AdditionalEmployees?.map(ae => ({
        employeeId: ae.employeeId,
        role: ae.role,
        Employee: ae.Employee ? {
          id: ae.Employee.id,
          User: ae.Employee.User ? {
            name: ae.Employee.User.name
          } : null
        } : null
      })) || []
    };
  }

  // Si es solo el ID, buscar en BD (raro, pero por seguridad)
  return { id: appointment.id || appointment, loading: true };
}

/**
 * Obtiene estadísticas de conexión (para monitoreo)
 */
function getConnectionStats() {
  return {
    total: connectionStats.total,
    byBusiness: Object.fromEntries(connectionStats.byBusiness),
    byRole: Object.fromEntries(connectionStats.byRole),
    memoryUsage: process.memoryUsage()
  };
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
  emitNewAppointment,
  emitAppointmentUpdate,
  emitAppointmentCancelled,
  getConnectionStats
};
