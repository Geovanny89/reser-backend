const { Appointment, Service, Employee, User, AppointmentEmployee } = require('../../../models');
const { Op } = require('sequelize');
const { APPOINTMENT_STATUS, MESSAGE_FLOW_STATUS } = require('../constants');
const { emitAppointmentUpdate, emitAppointmentCancelled } = require('../../../services/socketService');

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
    clientName, clientPhone, clientEmail, serviceId, employeeId, startTime, notes
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

  if (serviceId && serviceId !== appointment.serviceId) {
    const service = await Service.findByPk(serviceId);
    if (!service) throw new Error('Servicio no encontrado');
    updateData.serviceId = serviceId;

    // Recalcular endTime si cambió el servicio
    const durationMin = service.durationMin || service.duration || 30;
    if (startTime) {
      const start = new Date(startTime);
      updateData.startTime = start;
      updateData.endTime = new Date(start.getTime() + durationMin * 60000);
    } else {
      const currentStart = new Date(appointment.startTime);
      updateData.endTime = new Date(currentStart.getTime() + durationMin * 60000);
    }
  }

  if (employeeId) updateData.employeeId = employeeId;

  if (startTime && !updateData.startTime) {
    const parsedStartTime = new Date(startTime);
    if (!isNaN(parsedStartTime.getTime())) {
      const service = await Service.findByPk(updateData.serviceId || appointment.serviceId);
      const durationMin = service?.durationMin || service?.duration || 30;
      updateData.startTime = parsedStartTime;
      updateData.endTime = new Date(parsedStartTime.getTime() + durationMin * 60000);
    }
  }

  await appointment.update(updateData);

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
