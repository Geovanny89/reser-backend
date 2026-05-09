const { User } = require('../../../models');
const { sendEmail } = require('../../../config/email');
const { scheduleMessage } = require('../../../services/schedulerService');
const { generatePaymentReceipt } = require('../../../utils/pdfGenerator');
const { formatDateColombia } = require('../utils');
const { MESSAGE_FLOW_STATUS } = require('../constants');

/**
 * Función auxiliar para enviar comprobante de pago o orden de servicio
 */
async function sendPaymentReceiptAction(appointment) {
  // Determinar el email del cliente
  let clientEmail = null;
  if (appointment.clientId) {
    const clientUser = await User.findByPk(appointment.clientId);
    clientEmail = clientUser?.email || null;
  }
  if (!clientEmail && appointment.clientEmail) {
    clientEmail = appointment.clientEmail;
  }

  if (!clientEmail) {
    console.log('[Email] No se encontró email del cliente para enviar comprobante');
    return;
  }

  const isTechnicalService = appointment.Business?.isTechnicalServices || appointment.Business?.hasFieldTechnicians || false;
  const orderNumber = appointment.id.substring(0, 8).toUpperCase();

  const basePrice = parseFloat(appointment.basePrice || appointment.Service?.price || 0);
  // Calcular total de cargos adicionales desde el array
  const additionalCharges = appointment.additionalCharges || [];
  const additional = additionalCharges.reduce((sum, charge) => sum + parseFloat(charge.amount || 0), 0);
  const totalPrice = basePrice + additional;

  // Generar PDF
  const pdfBuffer = await generatePaymentReceipt({
    businessId: appointment.businessId,
    businessName: appointment.Business?.name,
    businessLogoUrl: appointment.Business?.logoUrl,
    businessAddress: appointment.Business?.address,
    businessPhone: appointment.Business?.phone,
    businessNit: appointment.Business?.nit,
    id: appointment.id,
    clientName: appointment.clientName,
    clientEmail: appointment.clientEmail,
    clientPhone: appointment.clientPhone,
    serviceName: appointment.Service?.name,
    serviceDescription: appointment.Service?.description,
    employeeName: appointment.Employee?.User?.name,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    price: basePrice,
    additionalAmount: additional,
    additionalNote: appointment.additionalNote,
    paymentMethod: appointment.paymentMethod || 'Efectivo',
    notes: appointment.notes,
    isTechnicalService: isTechnicalService,
    clientSignature: appointment.clientSignature,
    clientSignatureName: appointment.clientSignatureName,
    clientSignatureDate: appointment.clientSignatureDate,
    workEvidences: appointment.workEvidences,
    workReport: appointment.workReport,
  });

  const emailTemplate = isTechnicalService ? 'serviceOrder' : 'paymentReceipt';
  const emailData = isTechnicalService ? {
    clientName: appointment.clientName,
    businessName: appointment.Business?.name,
    serviceName: appointment.Service?.name,
    employeeName: appointment.Employee?.User?.name,
    startTime: appointment.startTime,
    price: totalPrice,
    orderNumber,
    notes: appointment.notes,
  } : {
    clientName: appointment.clientName,
    businessName: appointment.Business?.name,
    serviceName: appointment.Service?.name,
    startTime: appointment.startTime,
    price: totalPrice,
    receiptNumber: orderNumber,
  };

  const filename = isTechnicalService ? `reporte-servicio-${orderNumber}.pdf` : `comprobante-${orderNumber}.pdf`;

  await sendEmail(
    clientEmail,
    emailTemplate,
    emailData,
    [{
      filename,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }]
  );

  console.log(`[Email] Comprobante enviado a ${clientEmail} para cita ${appointment.id}`);
}

/**
 * Envia email de solicitud de calificación al cliente
 */
async function sendRatingEmailAction(appointment) {
  try {
    // Determinar el email del cliente
    let clientEmail = null;
    if (appointment.clientId) {
      const clientUser = await User.findByPk(appointment.clientId);
      clientEmail = clientUser?.email || null;
    }
    if (!clientEmail && appointment.clientEmail) {
      clientEmail = appointment.clientEmail;
    }

    if (!clientEmail) {
      console.log('[Rating Email] No se encontró email del cliente para enviar calificación');
      return;
    }

    // Verificar si ya se envió la calificación anteriormente
    if (appointment.ratingEmailSent) {
      console.log(`[Rating Email] Ya se envió calificación anteriormente para cita ${appointment.id}`);
      return;
    }

    const baseUrl = process.env.FRONTEND_URL || 'https://k-dice.com';
    const ratingBaseUrl = `${baseUrl}/rate-employee`;

    await sendEmail(
      clientEmail,
      'serviceCompletedRating',
      {
        clientName: appointment.clientName,
        businessName: appointment.Business?.name || 'Nuestro negocio',
        serviceName: appointment.Service?.name || 'Servicio',
        employeeName: appointment.Employee?.User?.name || 'El técnico',
        ratingBaseUrl,
        appointmentId: appointment.id,
      }
    );

    // Marcar que ya se envió el email de calificación
    await appointment.update({ ratingEmailSent: true, ratingEmailSentAt: new Date() });
    console.log(`[Rating Email] ✅ Enviado a ${clientEmail} para cita ${appointment.id}`);
  } catch (err) {
    console.error('[Rating Email] ❌ Error enviando solicitud de calificación:', err.message);
  }
}

/**
 * Programa mensaje de calificación por WhatsApp
 */
async function scheduleRatingMessageAction(appointment) {
  const ratingTime = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos después
  const phone = appointment.clientPhone;
  
  if (!phone) {
    console.log(`[Rating] No hay teléfono para cita ${appointment.id}, saltando mensaje`);
    return;
  }

  const message = `¡Hola *${appointment.clientName}*! 👋\n\nGracias por tu visita el *${formatDateColombia(appointment.startTime)}* a *${appointment.Business?.name || 'nuestro negocio'}*.\n\n⭐ ¿Cómo fue tu experiencia? Responde con una calificación del 1 al 5. ¡Tu opinión nos ayuda!`;

  await scheduleMessage({
    businessId: appointment.businessId,
    appointmentId: appointment.id,
    phone: phone,
    message: message,
    type: 'rating',
    scheduledAt: ratingTime
  });

  await appointment.update({
    ratingSent: true,
    ratingSentAt: ratingTime,
    messageFlowStatus: MESSAGE_FLOW_STATUS.AWAITING_RATING
  });

  console.log(`[Rating] Mensaje programado para cita ${appointment.id} a las ${ratingTime}`);
}

module.exports = {
  sendPaymentReceipt: sendPaymentReceiptAction,
  sendRatingEmail: sendRatingEmailAction,
  scheduleRatingMessage: scheduleRatingMessageAction
};
