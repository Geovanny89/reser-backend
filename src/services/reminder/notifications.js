/**
 * Envío de notificaciones (WhatsApp, Push, Email)
 */
const { sendEmail } = require('../../config/email');
const { sendPushNotification } = require('../pushNotificationService');
const { scheduleMessage } = require('../schedulerService');
const { findClientPushToken, findClientEmail } = require('./queries');
const { COLOMBIA_OFFSET_MS } = require('../scheduler/time.utils');

async function scheduleWhatsAppMessage(appt, message, type = 'reminder') {
  if (!appt.clientPhone || appt.Business?.hasFieldTechnicians) return false;

  try {
    // Compute current time in Colombia (UTC‑5) to avoid timezone offset issues
    const colombiaNow = new Date(Date.now() + COLOMBIA_OFFSET_MS);
    const scheduled = await scheduleMessage({
      businessId: appt.businessId,
      appointmentId: appt.id,
      phone: appt.clientPhone,
      message,
      type,
      scheduledAt: colombiaNow,
    });
    console.log(`[Reminder] ✅ Mensaje ${type} programado (ID: ${scheduled.id.slice(0, 8)}) para cita ${appt.id.slice(0, 8)}`);
    return true;
  } catch (err) {
    console.error(`[Reminder] ❌ Error programando mensaje ${type}:`, err.message);
    return false;
  }
}

async function sendClientPush(appt, title, body, type) {
  const token = await findClientPushToken(appt);
  if (token) {
    await sendPushNotification(token, { title, body }, { type, appointmentId: appt.id });
  }
  return !!token;
}

async function sendEmployeePush(appt, title, body) {
  const token = appt.Employee?.User?.pushToken;
  if (token) {
    await sendPushNotification(token, { title, body }, {
      type: 'appointment_reminder',
      appointmentId: appt.id,
    });
  }
  return !!token;
}

async function sendTechnicianPush(appt, title, body, urgency = 'normal') {
  const token = appt.Employee?.User?.pushToken;
  if (token) {
    await sendPushNotification(token, { title, body }, {
      type: 'technician_field_reminder',
      appointmentId: appt.id,
      urgency,
    });
  }
  return !!token;
}

async function sendClientEmail(appt, needsConfirmation) {
  const clientEmail = await findClientEmail(appt);
  if (!clientEmail) return false;

  try {
    const subject = needsConfirmation
      ? 'Confirma tu cita (2 horas)'
      : 'Recordatorio de cita';

    await sendEmail(clientEmail, 'appointmentReminder', {
      clientName: String(appt.clientName || ''),
      businessName: String(appt.Business?.name || 'KDice'),
      serviceName: String(appt.Service?.name || 'Servicio'),
      employeeName: String(appt.Employee?.User?.name || 'Profesional'),
      startTime: String(appt.startTime),
      needsConfirmation,
    });
    return true;
  } catch (err) {
    console.log(`[Reminder] ⚠️ Email falló (ignorado): ${err.message}`);
    return false;
  }
}

module.exports = {
  scheduleWhatsAppMessage,
  sendClientPush,
  sendEmployeePush,
  sendTechnicianPush,
  sendClientEmail,
};
