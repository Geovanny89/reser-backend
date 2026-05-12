/**
 * Gestión de técnicos en campo y reportes técnicos
 */

const { Appointment, AppointmentNote, User, Op } = require('../../models');
const { getAppointmentById } = require('./queries');
const { emitAppointmentUpdate } = require('../../services/socketService');
const { sendPushNotification } = require('../../services/pushNotificationService');

// Estados válidos de técnico (deben coincidir con el ENUM del modelo y el frontend)
const TECHNICIAN_STATUS = {
  PENDIENTE: 'pending',
  EN_CAMINO: 'on_the_way',
  LLEGUE: 'arrived',
  EN_ATENCION: 'in_progress',
  COMPLETADO: 'done'
};

/**
 * Actualiza estado del técnico en campo
 */
async function updateTechnicianStatus(appointmentId, status, userId) {
  if (!Object.values(TECHNICIAN_STATUS).includes(status)) {
    throw new Error('Estado no válido');
  }

  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  const updateData = {};
  const now = new Date();

  switch (status) {
    case TECHNICIAN_STATUS.EN_CAMINO:
      updateData.travelStartTime = now;
      updateData.technicianStatus = status;
      break;
    case TECHNICIAN_STATUS.LLEGUE:
      updateData.arrivalTime = now;
      updateData.technicianStatus = status;
      break;
    case TECHNICIAN_STATUS.EN_ATENCION:
      updateData.serviceStartTime = now;
      updateData.technicianStatus = status;
      // IMPORTANTE: También actualizar status a 'attention' para sincronizar con flujo de belleza
      // Esto asegura que el socket funcione correctamente para todos los listeners
      updateData.status = 'attention';
      // Si no hay nota de inicio, crear una
      if (!appointment.notes?.includes('Inicio de servicio')) {
        const { AppointmentNote } = require('../../models');
        await AppointmentNote.create({
          appointmentId,
          userId,
          content: `Inicio de servicio - ${now.toLocaleString('es-CO')}`,
          type: 'system'
        });
      }
      break;
    case TECHNICIAN_STATUS.PENDIENTE:
      updateData.technicianStatus = status;
      break;
    case TECHNICIAN_STATUS.COMPLETADO:
      updateData.serviceEndTime = now;
      updateData.technicianStatus = status;
      break;
  }

  await appointment.update(updateData);

  // Recargar la cita con relaciones completas para emitir (igual que updateAppointmentStatus)
  const { Appointment, Service, Employee, User, Business, AppointmentEmployee } = require('../../models');
  const updatedAppointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: Business, attributes: ['id', 'name', 'whatsapp', 'address', 'slug', 'logoUrl', 'isTechnicalServices', 'nit', 'phone'] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ]
  });

  // Debug: verificar qué se va a emitir
  const appointmentJson = updatedAppointment.toJSON();
  console.log('[TechnicianStatus] Datos a emitir:', {
    id: appointmentJson.id,
    status: appointmentJson.status,
    technicianStatus: appointmentJson.technicianStatus,
    hasService: !!appointmentJson.Service,
    hasEmployee: !!appointmentJson.Employee
  });

  // Emitir actualización en tiempo real
  emitAppointmentUpdate(appointmentJson);

  return updatedAppointment;
}

/**
 * Guarda reporte técnico con insumos usados
 */
async function saveTechnicalReport(appointmentId, data, userId) {
  const { diagnosis, solution, recommendations, partsUsed, markAsDone } = data;

  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  const workReport = {
    diagnosis: diagnosis || '',
    solution: solution || '',
    recommendations: recommendations || '',
    partsUsed: partsUsed || [],
    completedAt: markAsDone ? new Date() : null,
    completedBy: markAsDone ? userId : null
  };

  // Solo marcar como completada si se especifica explícitamente
  const updateData = { workReport };
  if (markAsDone) {
    updateData.status = 'done';
  }

  await appointment.update(updateData);

  // Crear nota de sistema
  const { AppointmentNote } = require('../../models');
  await AppointmentNote.create({
    appointmentId,
    userId,
    content: markAsDone
      ? `Reporte técnico completado - ${new Date().toLocaleString('es-CO')}`
      : `Reporte técnico actualizado - ${new Date().toLocaleString('es-CO')}`,
    type: 'system'
  });

  // Recargar la cita con los datos actualizados para emitir
  const updatedAppointment = await getAppointmentById(appointmentId);

  emitAppointmentUpdate(updatedAppointment.toJSON());

  return updatedAppointment;
}

/**
 * Obtiene reporte técnico de una cita
 */
async function getTechnicalReport(appointmentId, userId) {
  const appointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: AppointmentNote, order: [['createdAt', 'DESC']] }
    ]
  });

  if (!appointment) throw new Error('Cita no encontrada');

  // Verificar permisos
  const isAdmin = await checkIsAdmin(userId, appointment.businessId);
  const isAssignedEmployee = appointment.employeeId === userId;

  if (!isAdmin && !isAssignedEmployee) {
    throw new Error('No tienes permiso para ver este reporte');
  }

  return {
    appointment: {
      id: appointment.id,
      clientName: appointment.clientName,
      status: appointment.status,
      workReport: appointment.workReport
    },
    notes: appointment.AppointmentNotes
  };
}

/**
 * Verifica si un usuario es admin del negocio
 */
async function checkIsAdmin(userId, businessId) {
  const { Business, Employee } = require('../../models');

  const business = await Business.findOne({
    where: { id: businessId, ownerId: userId }
  });
  if (business) return true;

  const employee = await Employee.findOne({
    where: { userId, businessId, isManager: true }
  });
  return !!employee;
}

/**
 * Transfiere cita a otro empleado
 */
async function transferAppointment(appointmentId, newEmployeeId, newStartTime, user) {
  const { Op } = require('sequelize');
  const { Employee, EmployeeService, Appointment, Business } = require('../../models');

  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  if (appointment.status === 'cancelled' || appointment.status === 'done') {
    throw new Error('No se pueden transferir citas canceladas o completadas');
  }

  if (appointment.status === 'attention') {
    throw new Error('No se pueden transferir citas que están en atención');
  }

  // Get new employee details
  const newEmployee = await Employee.findByPk(newEmployeeId, {
    include: [{ model: require('../../models').User, attributes: ['name', 'pushToken'] }]
  });
  if (!newEmployee) throw new Error('Empleado destino no encontrado');
  if (newEmployee.businessId !== appointment.businessId) {
    throw new Error('El empleado destino no pertenece a este negocio');
  }

  // ========== VALIDACIÓN: El nuevo empleado debe tener el servicio asignado (o ser generalista) ==========
  const serviceId = appointment.serviceId;

  // Verificar si el empleado tiene ALGÚN servicio asignado
  const employeeServicesCount = await EmployeeService.count({
    where: { employeeId: newEmployeeId }
  });

  // Si el empleado tiene servicios asignados, verificar que pueda hacer este específico
  if (employeeServicesCount > 0) {
    const hasService = await EmployeeService.findOne({
      where: { employeeId: newEmployeeId, serviceId }
    });

    if (!hasService) {
      console.log(`[Transfer] ❌ Empleado ${newEmployeeId} no tiene asignado el servicio ${serviceId}`);
      throw new Error('No se puede reasignar la cita: El empleado seleccionado no tiene asignado este servicio. Asigna el servicio al empleado primero o selecciona otro empleado.');
    }

    console.log(`[Transfer] ✅ Empleado ${newEmployeeId} tiene el servicio ${serviceId} asignado`);
  } else {
    // El empleado no tiene servicios asignados = es generalista, puede hacer cualquier servicio
    console.log(`[Transfer] ✅ Empleado ${newEmployeeId} es generalista (sin servicios asignados), puede recibir cualquier cita`);
  }
  // ===================================================================================

  const updateData = {};

  // Calculate start and end times (use new time if provided, otherwise keep original)
  let startTime = appointment.startTime;
  let endTime = appointment.endTime;

  if (newStartTime) {
    startTime = new Date(newStartTime);
    endTime = new Date(startTime.getTime() + (appointment.Service?.durationMin || 60) * 60000);
  }

  // Check if new employee is already booked at the target time (skip for express appointments)
  const isExpressAppt = appointment.status === 'attention';

  if (!isExpressAppt) {
    const conflict = await Appointment.findOne({
      where: {
        employeeId: newEmployeeId,
        id: { [Op.ne]: appointmentId },
        status: { [Op.notIn]: ['cancelled'] },
        startTime: { [Op.lt]: new Date(endTime.getTime() - 10000) },
        endTime: { [Op.gt]: new Date(startTime.getTime() + 10000) },
      }
    });

    if (conflict) {
      throw new Error(`El empleado ${newEmployee.User?.name} ya tiene una cita en ese horario`);
    }
  }

  updateData.employeeId = newEmployeeId;
  updateData.startTime = startTime;
  updateData.endTime = endTime;

  await appointment.update(updateData);

  // Send push notification to new employee
  if (newEmployee.User?.pushToken) {
    await sendPushNotification(newEmployee.User.pushToken, {
      title: '📅 Cita Transferida',
      body: `Se te ha asignado una cita de ${appointment.clientName} - ${appointment.Service?.name} el ${new Date(appointment.startTime).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' })}`,
    }, {
      type: 'appointment_transferred',
      appointmentId: appointment.id,
      businessId: appointment.businessId,
      transferredFrom: appointment.Employee?.User?.name || 'Empleado anterior',
    });
  }

  // Recargar con relaciones
  const result = await getAppointmentById(appointmentId);
  emitAppointmentUpdate(result.toJSON());

  return {
    success: true,
    message: `Cita transferida exitosamente`,
    appointment: {
      id: result.id,
      employeeId: newEmployeeId,
      employeeName: newEmployee.User?.name,
      previousEmployeeName: appointment.Employee?.User?.name || 'Empleado anterior',
    }
  };
}

/**
 * Agrega cargo adicional a una cita
 */
async function addAdditionalCharge(appointmentId, additionalAmount, additionalNote) {
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  if (appointment.status !== 'done' && appointment.status !== 'attention') {
    throw new Error('Solo se pueden agregar cargos a citas en atención o completadas');
  }

  // Sumar el nuevo monto al adicional existente
  const currentAdditional = parseFloat(appointment.additionalAmount || 0);
  const newAdditional = currentAdditional + parseFloat(additionalAmount);
  const basePrice = parseFloat(appointment.basePrice || 0);
  const newFinalPrice = basePrice + newAdditional;

  await appointment.update({
    additionalAmount: newAdditional,
    additionalNote: additionalNote,
    finalPrice: newFinalPrice
  });

  return appointment;
}

/**
 * Guarda la firma del cliente para servicios a domicilio
 * @param {string} appointmentId - ID de la cita
 * @param {Object} data - Datos de la firma { signature: base64String, clientName: string }
 * @param {string} userId - ID del usuario que guarda la firma (técnico)
 */
async function saveClientSignature(appointmentId, data, userId) {
  const { signature, clientName } = data;

  if (!signature) {
    throw new Error('La firma es requerida');
  }

  // Validar que la firma sea un base64 válido (data:image/...)
  if (!signature.startsWith('data:image/')) {
    throw new Error('Formato de firma inválido. Debe ser base64 (data:image/png;base64,...)');
  }

  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  // Validar que la cita esté en estado que permita firma (en progreso o completada)
  if (appointment.status !== 'attention' && appointment.status !== 'done') {
    throw new Error('Solo se puede firmar citas en atención o completadas');
  }

  await appointment.update({
    clientSignature: signature,
    clientSignatureName: clientName || appointment.clientName || 'Cliente',
    clientSignatureDate: new Date()
  });

  // Crear nota de sistema
  await AppointmentNote.create({
    appointmentId,
    userId,
    content: `Firma del cliente guardada - ${new Date().toLocaleString('es-CO')} - ${clientName || appointment.clientName || 'Cliente'}`,
    type: 'system'
  });

  // Recargar y emitir actualización
  const updatedAppointment = await getAppointmentById(appointmentId);
  emitAppointmentUpdate(updatedAppointment.toJSON());

  return {
    success: true,
    message: 'Firma guardada exitosamente',
    appointmentId: appointment.id,
    clientSignatureName: updatedAppointment.clientSignatureName,
    clientSignatureDate: updatedAppointment.clientSignatureDate
  };
}

/**
 * Obtiene la firma del cliente de una cita
 * @param {string} appointmentId - ID de la cita
 * @param {string} userId - ID del usuario solicitante
 */
async function getClientSignature(appointmentId, userId) {
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  // Verificar permisos
  const isAdmin = await checkIsAdmin(userId, appointment.businessId);
  const isAssignedEmployee = appointment.employeeId === userId;

  if (!isAdmin && !isAssignedEmployee) {
    throw new Error('No tienes permiso para ver esta firma');
  }

  return {
    hasSignature: !!appointment.clientSignature,
    signature: appointment.clientSignature,
    clientName: appointment.clientSignatureName,
    signedAt: appointment.clientSignatureDate
  };
}

/**
 * Guarda evidencias fotográficas del trabajo realizado
 * @param {string} appointmentId - ID de la cita
 * @param {Object} data - Datos de las evidencias { photos: [{url, description}], replaceAll: boolean }
 * @param {string} userId - ID del usuario que guarda las evidencias
 */
async function saveWorkEvidences(appointmentId, data, userId) {
  const { photos, replaceAll = false } = data;

  if (!photos || !Array.isArray(photos) || photos.length === 0) {
    throw new Error('Se requiere al menos una foto de evidencia');
  }

  // Validar máximo 5 fotos
  if (photos.length > 5) {
    throw new Error('Máximo 5 fotos de evidencia permitidas');
  }

  // Validar que cada foto tenga URL
  for (const photo of photos) {
    if (!photo.url) {
      throw new Error('Cada foto debe tener una URL');
    }
  }

  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  // Preparar evidencias con metadata
  const now = new Date();
  const newEvidences = photos.map(photo => ({
    url: photo.url,
    description: photo.description || '',
    uploadedAt: now.toISOString(),
    uploadedBy: userId
  }));

  let workEvidences;
  if (replaceAll) {
    // Reemplazar todas las evidencias
    workEvidences = newEvidences;
  } else {
    // Agregar a las existentes (hasta máximo 5)
    const existing = appointment.workEvidences || [];
    workEvidences = [...existing, ...newEvidences].slice(0, 5);
  }

  await appointment.update({ workEvidences });

  // Crear nota de sistema
  await AppointmentNote.create({
    appointmentId,
    userId,
    content: `${replaceAll ? 'Reemplazadas' : 'Agregadas'} ${newEvidences.length} foto(s) de evidencia - ${now.toLocaleString('es-CO')}`,
    type: 'system'
  });

  // Recargar y emitir actualización
  const updatedAppointment = await getAppointmentById(appointmentId);
  emitAppointmentUpdate(updatedAppointment.toJSON());

  return {
    success: true,
    message: `${newEvidences.length} foto(s) guardada(s) exitosamente`,
    appointmentId: appointment.id,
    totalPhotos: workEvidences.length,
    workEvidences
  };
}

/**
 * Obtiene evidencias fotográficas de una cita
 * @param {string} appointmentId - ID de la cita
 * @param {string} userId - ID del usuario solicitante
 */
async function getWorkEvidences(appointmentId, userId) {
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  // Verificar permisos
  const isAdmin = await checkIsAdmin(userId, appointment.businessId);
  const isAssignedEmployee = appointment.employeeId === userId;

  if (!isAdmin && !isAssignedEmployee) {
    throw new Error('No tienes permiso para ver estas evidencias');
  }

  const evidences = appointment.workEvidences || [];

  return {
    hasEvidences: evidences.length > 0,
    count: evidences.length,
    photos: evidences,
    maxAllowed: 5
  };
}

/**
 * Elimina una evidencia fotográfica específica
 * @param {string} appointmentId - ID de la cita
 * @param {number} photoIndex - Índice de la foto a eliminar
 * @param {string} userId - ID del usuario
 */
async function deleteWorkEvidence(appointmentId, photoIndex, userId) {
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  // Verificar permisos
  const isAdmin = await checkIsAdmin(userId, appointment.businessId);
  const isAssignedEmployee = appointment.employeeId === userId;

  if (!isAdmin && !isAssignedEmployee) {
    throw new Error('No tienes permiso para eliminar evidencias');
  }

  const evidences = appointment.workEvidences || [];

  if (photoIndex < 0 || photoIndex >= evidences.length) {
    throw new Error('Índice de foto inválido');
  }

  const removedPhoto = evidences[photoIndex];
  const updatedEvidences = evidences.filter((_, idx) => idx !== photoIndex);

  await appointment.update({ workEvidences: updatedEvidences });

  // Crear nota de sistema
  await AppointmentNote.create({
    appointmentId,
    userId,
    content: `Eliminada foto de evidencia #${photoIndex + 1} - ${new Date().toLocaleString('es-CO')}`,
    type: 'system'
  });

  return {
    success: true,
    message: 'Foto eliminada exitosamente',
    removedPhoto,
    remainingCount: updatedEvidences.length
  };
}

module.exports = {
  updateTechnicianStatus,
  saveTechnicalReport,
  getTechnicalReport,
  transferAppointment,
  addAdditionalCharge,
  saveClientSignature,
  getClientSignature,
  saveWorkEvidences,
  getWorkEvidences,
  deleteWorkEvidence,
  TECHNICIAN_STATUS
};
