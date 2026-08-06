const { Appointment, Service, Employee, User, AppointmentEmployee } = require('../../../models');
const { Op } = require('sequelize');
const { APPOINTMENT_STATUS, MESSAGE_FLOW_STATUS } = require('../constants');
const { emitAppointmentUpdate, emitAppointmentCancelled } = require('../../../services/socketService');
const { assertNoBlockConflicts } = require('../conflictUtils');

/**
 * Cancela una cita
 */
async function cancelAppointment(appointmentId, reason, user) {
  const appointment = await Appointment.findByPk(appointmentId, {
    include: [{ model: require('../../../models').Business, attributes: ['id', 'name'] }]
  });

  if (!appointment) throw new Error('Cita no encontrada');

  await appointment.update({
    status: APPOINTMENT_STATUS.CANCELLED,
    cancelledAt: new Date(),
    cancelledBy: user?.id || null,
    cancellationReason: reason || null,
    messageFlowStatus: MESSAGE_FLOW_STATUS.COMPLETED
  });

  // Emitir cancelación
  emitAppointmentCancelled(appointment.toJSON(), user?.id);

  return appointment;
}

/**
 * Actualiza datos de una cita
 */
async function updateAppointment(appointmentId, data) {
  const {
    clientName, clientPhone, clientEmail, serviceId, employeeId, startTime, notes,
    extraServices, additionalEmployeeIds
  } = data;

  const appointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] }
    ]
  });

  if (!appointment) throw new Error('Cita no encontrada');

  const updateData = {};

  if (clientName) updateData.clientName = clientName.trim();
  if (clientPhone) updateData.clientPhone = clientPhone.replace(/\D/g, '');
  if (clientEmail) updateData.clientEmail = clientEmail.toLowerCase().trim();
  if (notes !== undefined) updateData.notes = notes;
  if (employeeId) updateData.employeeId = employeeId;
  if (extraServices !== undefined) updateData.extraServices = extraServices;

  let currentServiceId = serviceId || appointment.serviceId;
  if (serviceId && serviceId !== appointment.serviceId) {
    updateData.serviceId = serviceId;
  }

  // Recalcular endTime siempre si hay cambio de servicio, extraServices o startTime
  if (serviceId || startTime || extraServices !== undefined) {
    const service = await Service.findByPk(currentServiceId);
    if (!service) throw new Error('Servicio no encontrado');

    const mainDuration = parseInt(service.durationMin || 30);
    const currentExtras = extraServices !== undefined ? extraServices : (appointment.extraServices || []);
    const start = startTime ? new Date(startTime) : new Date(appointment.startTime);

    // ========== BLOQUES SECUENCIALES POR PROFESIONAL (mismo flujo que create.js) ==========
    const principalEmpId = employeeId || appointment.employeeId;
    const blocks = [];
    let cursor = start.getTime();

    // Bloque 0: Servicio BASE → principal
    const mainEnd = cursor + mainDuration * 60000;
    blocks.push({
      employeeId: principalEmpId,
      startTime: new Date(cursor),
      endTime: new Date(mainEnd),
      durationMin: mainDuration,
      label: `Servicio: ${service.name}`
    });
    cursor = mainEnd;

    // Bloques extras secuenciales
    currentExtras.forEach((es, idx) => {
      const d = parseInt(es.durationMin) || 0;
      const blockStart = cursor;
      const blockEnd = cursor + d * 60000;
      const empForExtra = es.employeeId && String(es.employeeId) !== String(principalEmpId)
        ? es.employeeId
        : principalEmpId;
      blocks.push({
        employeeId: empForExtra,
        startTime: new Date(blockStart),
        endTime: new Date(blockEnd),
        durationMin: d,
        label: `Extra: ${es.name || 'Extra ' + (idx + 1)}`
      });
      cursor = blockEnd;
    });

    const totalDuration = blocks.reduce((s, b) => s + b.durationMin, 0);
    const newEnd = new Date(cursor);

    // Validar conflictos por TRAMO REAL (excluyendo la cita actual)
    await assertNoBlockConflicts(blocks, {
      businessId: appointment.businessId,
      excludeAppointmentId: appointmentId
    });

    if (startTime) updateData.startTime = start;
    updateData.endTime = newEnd;
  }

  await appointment.update(updateData);

  // Actualizar empleados adicionales si fueron proporcionados
  // (también fusionar empleados asignados en extraServices)
  if (additionalEmployeeIds !== undefined || extraServices !== undefined) {
    const principalId = String(updateData.employeeId || appointment.employeeId);
    const currentExtras = extraServices !== undefined ? extraServices : (appointment.extraServices || []);
    const fromExtras = (currentExtras || [])
      .map(es => (es?.employeeId != null ? String(es.employeeId) : null))
      .filter(id => id && id !== principalId);
    const fromExplicit = (additionalEmployeeIds || []).map(id => String(id)).filter(Boolean);
    const merged = [...new Set([...fromExplicit, ...fromExtras])].filter(id => id !== principalId);

    await AppointmentEmployee.destroy({ where: { appointmentId } });
    if (merged.length > 0) {
      const appointmentEmployees = merged.map((addEmpId, index) => ({
        appointmentId,
        employeeId: addEmpId,
        role: index === 0 ? 'auxiliar' : 'apoyo'
      }));
      await AppointmentEmployee.bulkCreate(appointmentEmployees);
    }
  }

  // Recargar con relaciones
  const result = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ]
  });

  emitAppointmentUpdate(result.toJSON());

  return result;
}

/**
 * Extiende el tiempo de una cita en curso
 */
async function extendTimeAction(appointmentId, data, user) {
  const { additionalMinutes } = data;
  const { getAppointmentById } = require('../queries');
  const { Appointment, Op } = require('../../../models');

  if (!additionalMinutes || additionalMinutes < 1) {
    throw new Error('Minutos adicionales inválidos');
  }

  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  const allowedStatuses = ['attention', 'in_progress'];
  if (!allowedStatuses.includes(appointment.status)) {
    throw new Error(`Solo se pueden extender citas en atención. Estado actual: ${appointment.status}`);
  }

  const currentEnd = new Date(appointment.endTime);
  const newEnd = new Date(currentEnd.getTime() + additionalMinutes * 60000);

  // VALIDACIÓN: Verificar si la extensión choca con la siguiente cita
  const nextAppointment = await Appointment.findOne({
    where: {
      employeeId: appointment.employeeId,
      businessId: appointment.businessId,
      status: { [Op.notIn]: ['cancelled'] },
      id: { [Op.ne]: appointment.id },
      startTime: { [Op.lt]: newEnd },
      endTime: { [Op.gt]: currentEnd }
    },
    order: [['startTime', 'ASC']]
  });

  if (nextAppointment) {
    const startTimeStr = new Date(nextAppointment.startTime).toLocaleTimeString('es-CO', { 
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' 
    });
    throw new Error(`No se puede extender: El empleado tiene otra cita a las ${startTimeStr}`);
  }

  const newExtendedDuration = (appointment.extendedDuration || 0) + parseInt(additionalMinutes);

  await appointment.update({ 
    endTime: newEnd,
    extendedDuration: newExtendedDuration
  });

  const updatedAppointment = await getAppointmentById(appointmentId);
  emitAppointmentUpdate(updatedAppointment.toJSON());

  return updatedAppointment;
}

module.exports = {
  cancelAppointment,
  updateAppointment,
  extendTime: extendTimeAction
};
