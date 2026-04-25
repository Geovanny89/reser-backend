/**
 * Endpoints públicos para clientes (sin autenticación)
 * - Confirmación de asistencia
 * - Cancelación desde email
 * - Calificación de citas
 */

const { Appointment, Service, Employee, User, Business, Op } = require('../../models');
const { getAppointmentById } = require('./queries');
const { formatDateColombia, formatTimeColombia } = require('./utils');
const { sendEmail } = require('../../config/email');
const { APPOINTMENT_STATUS, MESSAGE_FLOW_STATUS } = require('./constants');

/**
 * Confirma asistencia a una cita (desde link de email)
 */
async function confirmAttendance(appointmentId) {
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new Error('La cita ha sido cancelada');
  }

  if (appointment.status === APPOINTMENT_STATUS.DONE) {
    throw new Error('La cita ya fue completada');
  }

  if (appointment.confirmed) {
    return { alreadyConfirmed: true, appointment };
  }

  await appointment.update({
    confirmed: true,
    confirmedAt: new Date(),
    status: APPOINTMENT_STATUS.CONFIRMED,
    messageFlowStatus: MESSAGE_FLOW_STATUS.NOT_STARTED
  });

  // Notificar al negocio
  try {
    const business = await Business.findByPk(appointment.businessId);
    if (business?.ownerId) {
      const owner = await User.findByPk(business.ownerId);
      if (owner?.email) {
        await sendEmail(owner.email, 'appointmentConfirmed', {
          businessName: business.name,
          clientName: appointment.clientName,
          serviceName: appointment.Service?.name || 'Servicio',
          employeeName: appointment.Employee?.User?.name || 'Sin asignar',
          date: formatDateColombia(appointment.startTime),
          time: formatTimeColombia(appointment.startTime)
        });
      }
    }
  } catch (emailErr) {
    console.error('[confirmAttendance] Error enviando email:', emailErr.message);
  }

  return { success: true, appointment };
}

/**
 * Cancela una cita desde link de email
 */
async function cancelFromEmail(appointmentId, reason) {
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    return { alreadyCancelled: true, appointment };
  }

  if (appointment.status === APPOINTMENT_STATUS.DONE) {
    throw new Error('No se puede cancelar una cita completada');
  }

  // Verificar restricción de 12 horas
  const now = new Date();
  const apptTime = new Date(appointment.startTime);
  const diffHours = (apptTime - now) / (1000 * 60 * 60);

  if (diffHours < 12) {
    throw new Error('No se puede cancelar la cita porque faltan menos de 12 horas');
  }

  await appointment.update({
    status: APPOINTMENT_STATUS.CANCELLED,
    cancelledAt: new Date(),
    cancellationReason: reason || 'Cancelado por cliente desde email',
    messageFlowStatus: MESSAGE_FLOW_STATUS.COMPLETED
  });

  // Notificar al negocio
  try {
    const business = await Business.findByPk(appointment.businessId);
    if (business?.ownerId) {
      const owner = await User.findByPk(business.ownerId);
      if (owner?.email) {
        await sendEmail(owner.email, 'appointmentCancelled', {
          businessName: business.name,
          clientName: appointment.clientName,
          serviceName: appointment.Service?.name || 'Servicio',
          employeeName: appointment.Employee?.User?.name || 'Sin asignar',
          startTime: appointment.startTime,
          cancelTime: new Date()
        });
      }
    }
  } catch (emailErr) {
    console.error('[cancelFromEmail] Error enviando email:', emailErr.message);
  }

  return { success: true, appointment };
}

/**
 * Verifica si una cita puede ser calificada
 */
async function verifyForRating(appointmentId) {
  const appointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Business, attributes: ['id', 'name', 'logoUrl'] },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] }
    ]
  });

  if (!appointment) {
    return { valid: false, error: 'Cita no encontrada' };
  }

  // Verificar que la cita esté completada
  if (appointment.status !== APPOINTMENT_STATUS.DONE) {
    return { valid: false, error: 'La cita aún no ha sido completada' };
  }

  // Verificar que no haya sido calificada antes
  if (appointment.rating) {
    return { 
      valid: false, 
      alreadyRated: true,
      rating: appointment.rating,
      error: 'Esta cita ya fue calificada'
    };
  }

  // Verificar que la solicitud de calificación haya sido enviada
  if (!appointment.ratingSent) {
    return { valid: false, error: 'Esta cita no está disponible para calificación' };
  }

  // Verificar que no hayan pasado más de 48 horas desde que se envió la solicitud
  const sentAt = new Date(appointment.ratingSentAt);
  const now = new Date();
  const diffHours = (now - sentAt) / (1000 * 60 * 60);

  if (diffHours > 48) {
    return { valid: false, error: 'El período de calificación ha expirado (48 horas)' };
  }

  return {
    valid: true,
    appointment: {
      id: appointment.id,
      clientName: appointment.clientName,
      serviceName: appointment.Service?.name,
      businessName: appointment.Business?.name,
      businessLogo: appointment.Business?.logoUrl,
      employeeName: appointment.Employee?.User?.name,
      date: formatDateColombia(appointment.startTime),
      time: formatTimeColombia(appointment.startTime)
    }
  };
}

/**
 * Califica una cita
 */
async function rateAppointment(appointmentId, rating, comment) {
  if (!rating || rating < 1 || rating > 5) {
    throw new Error('La calificación debe ser entre 1 y 5');
  }

  const appointment = await Appointment.findByPk(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  if (appointment.status !== APPOINTMENT_STATUS.DONE) {
    throw new Error('Solo se pueden calificar citas completadas');
  }

  if (appointment.rating) {
    throw new Error('Esta cita ya fue calificada');
  }

  await appointment.update({
    rating,
    ratingComment: comment || null,
    messageFlowStatus: MESSAGE_FLOW_STATUS.COMPLETED
  });

  // Notificar al negocio sobre la nueva calificación
  try {
    const business = await Business.findByPk(appointment.businessId);
    if (business?.ownerId) {
      const owner = await User.findByPk(business.ownerId);
      if (owner?.email) {
        await sendEmail(owner.email, 'newRating', {
          businessName: business.name,
          clientName: appointment.clientName,
          rating,
          comment: comment || 'Sin comentario',
          date: formatDateColombia(appointment.startTime)
        });
      }
    }
  } catch (emailErr) {
    console.error('[rateAppointment] Error enviando email:', emailErr.message);
  }

  return { success: true, appointment };
}

module.exports = {
  confirmAttendance,
  cancelFromEmail,
  verifyForRating,
  rateAppointment
};
