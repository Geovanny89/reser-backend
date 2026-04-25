/**
 * Emisores de eventos relacionados con citas
 */

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
        price: appointment.Service.price,
      } : null,
      Employee: appointment.Employee ? {
        id: appointment.Employee.id,
        User: appointment.Employee.User ? {
          name: appointment.Employee.User.name,
        } : null,
      } : null,
      AdditionalEmployees: appointment.AdditionalEmployees?.map(ae => ({
        employeeId: ae.employeeId,
        role: ae.role,
        Employee: ae.Employee ? {
          id: ae.Employee.id,
          User: ae.Employee.User ? {
            name: ae.Employee.User.name,
          } : null,
        } : null,
      })) || [],
    };
  }

  // Si es solo el ID, buscar en BD (raro, pero por seguridad)
  return { id: appointment.id || appointment, loading: true };
}

/**
 * Crea emisores de citas vinculados a la instancia de io
 */
function createAppointmentEmitters(io) {

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
      employeeId: appointment.employeeId,
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
            isAdditionalEmployee: true,
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
          action: 'created',
        });
    }
  }

  /**
   * Emite actualización de estado de cita
   */
  async function emitAppointmentUpdate(appointment, updateType = 'updated') {
    if (!io) {
      console.log('[Socket Emitter] ERROR: io no está inicializado');
      return;
    }

    const apptData = await formatAppointmentData(appointment);
    console.log(`[Socket Emitter] Emitiendo appointment:${updateType} para cita ${appointment.id}`, {
      businessId: appointment.businessId,
      employeeId: appointment.employeeId,
      status: appointment.status,
      technicianStatus: appointment.technicianStatus,
      hasService: !!appointment.Service,
      hasEmployee: !!appointment.Employee,
      apptDataTechnicianStatus: apptData.technicianStatus
    });

    // Verificar cuántos clientes están en cada sala
    const businessRoomSize = io.sockets.adapter.rooms.get(`business:${appointment.businessId}`)?.size || 0;
    const employeeRoomSize = appointment.employeeId ? (io.sockets.adapter.rooms.get(`employee:${appointment.employeeId}`)?.size || 0) : 0;
    console.log(`[Socket Emitter] Clientes en sala business:${appointment.businessId}: ${businessRoomSize}`);
    console.log(`[Socket Emitter] Clientes en sala employee:${appointment.employeeId}: ${employeeRoomSize}`);

    // Emitir a todos en el negocio
    io.to(`business:${appointment.businessId}`)
      .emit(`appointment:${updateType}`, apptData);
    console.log(`[Socket Emitter] Emitido a business:${appointment.businessId}`);

    // Emitir específicamente al empleado asignado
    if (appointment.employeeId) {
      io.to(`employee:${appointment.employeeId}`)
        .emit(`appointment:${updateType}`, apptData);
      console.log(`[Socket Emitter] Emitido a employee:${appointment.employeeId}`);
    }

    // Notificar cambio en fecha
    if (appointment.startTime) {
      const dateStr = new Date(appointment.startTime).toISOString().split('T')[0];
      io.to(`date:${appointment.businessId}:${dateStr}`)
        .emit('appointment:date_update', {
          date: dateStr,
          appointmentId: appointment.id,
          action: updateType,
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
        cancelledBy: cancelledBy || 'system',
      });
  }

  return {
    emitNewAppointment,
    emitAppointmentUpdate,
    emitAppointmentCancelled,
    formatAppointmentData,
  };
}

module.exports = { createAppointmentEmitters };
