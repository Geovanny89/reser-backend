const { Appointment, Service, Employee, Business, User, AppointmentEmployee, WhatsAppSession } = require('../../../models');
const { Op } = require('sequelize');
const { APPOINTMENT_STATUS } = require('../constants');
const { emitAppointmentUpdate } = require('../../../services/socketService');
const { getRandomRatingTemplate, hasValidSession } = require('../../../services/evolutionService');
const { scheduleMessage } = require('../../../services/schedulerService');
const { logActivity } = require('../../../utils/activityLogger');
const { registerCashMovementForAppointment, reverseCashMovementForAppointment } = require('./cashRegister');
const { sendPaymentReceipt, sendRatingEmail } = require('./notifications');

/**
 * Actualiza el estado de una cita
 */
async function updateAppointmentStatus(appointmentId, newStatus, user, options = {}) {
  // Manejar compatibilidad si options es solo paymentMethod (string)
  const opt = typeof options === 'string' ? { paymentMethod: options } : options;
  const { paymentMethod, discountApplied, finalPrice, additionalAmount, additionalNote } = opt;

  const appointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: Business, attributes: ['id', 'name', 'whatsapp', 'slug', 'isTechnicalServices', 'hasFieldTechnicians'] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ]
  });

  if (!appointment) throw new Error('Cita no encontrada');

  const oldStatus = appointment.status;
  const now = new Date();

  // Si el estado anterior era DONE y el nuevo NO lo es, reversar movimiento en caja
  if (oldStatus === APPOINTMENT_STATUS.DONE && newStatus !== APPOINTMENT_STATUS.DONE) {
    await reverseCashMovementForAppointment(appointment.id, user?.id);
  }

  // Actualizar según el nuevo estado
  const updateData = { status: newStatus };

  switch (newStatus) {
    case APPOINTMENT_STATUS.CONFIRMED:
      updateData.confirmed = true;
      updateData.confirmedAt = now;
      break;
    case APPOINTMENT_STATUS.ATTENTION:
      break;
    case APPOINTMENT_STATUS.DONE:
      // Si vienen valores explícitos desde el modal de completar, usarlos
      if (discountApplied !== undefined) updateData.discountApplied = parseFloat(discountApplied);
      if (finalPrice !== undefined) updateData.finalPrice = parseFloat(finalPrice);
      if (additionalAmount !== undefined) updateData.additionalAmount = parseFloat(additionalAmount);
      if (additionalNote !== undefined) updateData.additionalNote = additionalNote;

      // Calcular precio final si no viene explícitamente
      if (updateData.finalPrice === undefined) {
        const basePrice = parseFloat(appointment.basePrice || appointment.Service?.price || 0);
        const extraServices = updateData.extraServices || appointment.extraServices || [];
        const extrasAmount = extraServices.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
        const additionalCharges = appointment.additionalCharges || [];
        const additionalAmountSum = additionalCharges.reduce((sum, charge) => sum + parseFloat(charge.amount || 0), 0);
        const directAdditional = parseFloat(updateData.additionalAmount || appointment.additionalAmount || 0);
        const discount = parseFloat(updateData.discountApplied !== undefined ? updateData.discountApplied : (appointment.discountApplied || 0));
        
        updateData.finalPrice = Math.max(0, basePrice + extrasAmount + additionalAmountSum + directAdditional - discount);
      }

      // Guardar método de pago
      const finalPaymentMethod = paymentMethod || appointment.paymentMethod;
      if (finalPaymentMethod && ['cash', 'transfer'].includes(finalPaymentMethod)) {
        updateData.paymentMethod = finalPaymentMethod;
      }

      // Registrar movimiento en caja
      if (updateData.paymentMethod === 'cash' || updateData.paymentMethod === 'transfer') {
        try {
          const currentAppt = await Appointment.findByPk(appointmentId, { include: [{ model: Service }] });
          const apptForRegister = { 
            ...currentAppt.toJSON(), 
            ...updateData,
            Service: currentAppt.Service 
          };
          await registerCashMovementForAppointment(apptForRegister, user?.id);
        } catch (err) {
          console.error('[Cash Register] Error en registro inmediato:', err.message);
        }
      }

      // Enviar comprobante y solicitud de calificación
      if (oldStatus !== 'done') {
        setImmediate(() => {
          setTimeout(async () => {
            try {
              const freshAppt = await Appointment.findByPk(appointment.id, {
                include: [
                  { model: Service },
                  { model: Employee, include: [{ model: User, attributes: ['name'] }] },
                  { model: Business },
                  { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] },
                ]
              });

              if (!freshAppt) return;

              // 1. Enviar comprobante PDF
              const isAnyTechnical = freshAppt.Business?.isTechnicalServices || freshAppt.Business?.hasFieldTechnicians || false;
              if (!isAnyTechnical) {
                await sendPaymentReceipt(freshAppt).catch(e => console.error('[Receipt] Error:', e.message));
              }
 
              // 2. Enviar calificación por EMAIL
              const isFieldTechnical = freshAppt.Business?.hasFieldTechnicians || false;
              if (isFieldTechnical) {
                await sendRatingEmail(freshAppt).catch(e => console.error('[Rating Email] Error:', e.message));
              }

              // 3. Enviar calificación por WhatsApp
              if (!isFieldTechnical && freshAppt.clientPhone && !freshAppt.ratingSent) {
                try {
                  const resolvedBizId = await Business.resolveWhatsAppBusinessId(freshAppt.businessId);
                  let session = await WhatsAppSession.findOne({
                    where: {
                      businessId: { [Op.in]: [resolvedBizId, freshAppt.businessId] },
                      status: { [Op.in]: ['connected', 'session_saved'] }
                    }
                  });

                  if (!session) {
                    const hasValidWhatsApp = await hasValidSession(freshAppt.businessId) || await hasValidSession(resolvedBizId);
                    if (hasValidWhatsApp) {
                      session = { businessId: freshAppt.businessId, status: 'connected' };
                    }
                  }

                  if (session) {
                    const employeeName = freshAppt.Employee?.User?.name || 'nuestro profesional';
                    const businessName = freshAppt.Business?.name || 'nosotros';
                    const businessSlug = freshAppt.Business?.slug || freshAppt.businessId;
                    const ratingTemplate = getRandomRatingTemplate();
                    const baseUrl = process.env.FRONTEND_URL || 'https://k-dice.com';
                    const reviewLink = `${baseUrl}/${businessSlug}?review=true`;

                    const serviceDate = new Date(freshAppt.startTime).toLocaleDateString('es-CO', {
                      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota'
                    });
                    
                    const ratingText = `¡Hola *${freshAppt.clientName}*! 👋\n\nGracias por tu visita el *${serviceDate}* a *${businessName}*.\n\n${ratingTemplate}\n\n💇 Servicio con: *${employeeName}*\n\nResponde con un número del *1 al 5* ⭐`;
                    const reviewText = `¡Hola *${freshAppt.clientName}*! 👋\n\n¿Quieres ayudar a *${businessName}* a crecer?\n\n💬 Deja una reseña pública y ayuda a otros clientes a conocernos:\n👉 ${reviewLink}\n\n¡Gracias por tu confianza! ❤️`;

                    await scheduleMessage({
                      businessId: freshAppt.businessId,
                      appointmentId: freshAppt.id,
                      phone: freshAppt.clientPhone,
                      message: ratingText,
                      type: 'rating',
                      scheduledAt: new Date(Date.now() + 5 * 60 * 1000)
                    });

                    await freshAppt.update({
                      ratingSent: true,
                      ratingSentAt: new Date(),
                      messageFlowStatus: 'awaiting_rating'
                    });

                    await scheduleMessage({
                      businessId: freshAppt.businessId,
                      appointmentId: freshAppt.id,
                      phone: freshAppt.clientPhone,
                      message: reviewText,
                      type: 'review',
                      scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
                    });
                  }
                } catch (waErr) {
                  console.error('[Done Action] Error programando solicitud de calificación:', waErr.message);
                }
              }
            } catch (e) {
              console.error('[Done Action] Error general:', e.message);
            }
          }, 5000);
        });
      }
      break;
    case APPOINTMENT_STATUS.CANCELLED:
      updateData.cancelledAt = now;
      updateData.cancelledBy = user?.id || null;
      break;
    case APPOINTMENT_STATUS.NO_SHOW:
      break;
  }

  await appointment.update(updateData);

  // Registrar actividad
  if (user) {
    logActivity({ user }, {
      action: 'UPDATE_APPOINTMENT_STATUS',
      entityType: 'Appointment',
      entityId: appointmentId,
      businessId: appointment.businessId,
      description: `Estado de cita cambiado de ${oldStatus} a ${newStatus}`,
      oldValues: { status: oldStatus },
      newValues: { status: newStatus },
      metadata: { paymentMethod }
    });
  }

  // Recargar y emitir actualización
  const updatedAppointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: Business, attributes: ['id', 'name', 'whatsapp'] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ]
  });

  emitAppointmentUpdate(updatedAppointment.toJSON());

  return updatedAppointment;
}

module.exports = {
  updateAppointmentStatus
};
