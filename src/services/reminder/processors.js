/**
 * Procesadores de recordatorios
 */
const { getRelativeDayText, formatTime, formatDateTime } = require('./time.utils');
const configModule = require('./config');
const {
  generateConfirmedReminder24h,
  generateUnconfirmedReminder24h,
  generateConfirmedReminder12h,
  generateUnconfirmedReminder12h,
  generateConfirmedReminder2h,
  generateUnconfirmedReminder2h,
  generateReminder1h,
  generateGenericReminder,
  generateReferenceMessage,
} = require('./message.generators');
const {
  scheduleWhatsAppMessage,
  sendClientPush,
  sendEmployeePush,
  sendTechnicianPush,
  sendClientEmail,
} = require('./notifications');

async function processStandardReminder(appt, config, timeLabel) {
  const timeStr = formatTime(appt.startTime);
  const isConfirmed = appt.confirmed === true;

  let message, msgType = 'reminder';
  const REMINDER_CONFIG = configModule.REMINDER_CONFIG;
  if (!REMINDER_CONFIG) {
    throw new Error('REMINDER_CONFIG is undefined (circular dependency?)');
  }
  if (config.confirmation && !isConfirmed) {
    message = config.ms === REMINDER_CONFIG['24h'].ms ? generateUnconfirmedReminder24h(appt, timeStr)
      : config.ms === REMINDER_CONFIG['12h'].ms ? generateUnconfirmedReminder12h(appt, getRelativeDayText(new Date(appt.startTime), timeStr))
      : generateUnconfirmedReminder2h(appt, timeStr);
    msgType = 'confirmation';
  } else {
    // Si ya está confirmado, omitir mensajes de 24h y 12h (redundantes)
    if (config.confirmation && isConfirmed && (config.ms === REMINDER_CONFIG['24h'].ms || config.ms === REMINDER_CONFIG['12h'].ms)) {
      console.log(`[Reminder${timeLabel.replace(/\s/g, '')}] ⏭️ Omitiendo recordatorio porque la cita ya está confirmada.`);
      await appt.update({ [config.field]: true });
      return;
    }

    message = config.ms === REMINDER_CONFIG['24h'].ms ? generateConfirmedReminder24h(appt, timeStr)
      : config.ms === REMINDER_CONFIG['12h'].ms ? generateConfirmedReminder12h(appt, getRelativeDayText(new Date(appt.startTime), timeStr))
      : config.ms === REMINDER_CONFIG['2h'].ms ? generateConfirmedReminder2h(appt, timeStr)
      : generateReminder1h(appt, timeStr, isConfirmed);
  }

  const whatsappSent = await scheduleWhatsAppMessage(appt, message, msgType);

  const dayText = getRelativeDayText(new Date(appt.startTime), timeStr).replace(/\*/g, '');
  const title = (!isConfirmed && config.confirmation) ? '⏰ Confirma tu cita' : `📅 Recordatorio: Cita ${timeLabel}`;
  const body = (!isConfirmed && config.confirmation)
    ? `Tienes una cita para ${appt.Service?.name || 'Servicio'} en ${appt.Business?.name || 'Negocio'} ${dayText}. Responde SI para confirmar o NO para cancelar.`
    : `Tienes una cita para ${appt.Service?.name || 'Servicio'} en ${appt.Business?.name || 'Negocio'} ${dayText}.`;
  await sendClientPush(appt, title, body, (!isConfirmed && config.confirmation) ? 'appointment_confirm' : 'appointment_reminder');

  const updateData = { [config.field]: true };
  if (!isConfirmed && config.confirmation && whatsappSent) {
    updateData.messageFlowStatus = 'awaiting_confirmation';
  }
  await appt.update(updateData);

  console.log(`[Reminder${timeLabel.replace(/\s/g, '')}] ✅ Recordatorio completado para cita ${appt.id}`);
}

async function processGenericReminder(appt, timeLabel, fieldToUpdate) {
  // Para 1h y 30m, el cliente no recibe notificaciones (solo confirmación/recordatorio de 2h/12h/24h).
  // El push al empleado ya se envió desde core.js antes de llamar a esta función.
  await appt.update({ [fieldToUpdate]: true });
  console.log(`[Reminder] ✅ Registro de ${timeLabel} actualizado para cita ${appt.id} (Sin notificaciones al cliente)`);
}

async function processReferenceMessage(appt) {
  const startTimeStr = formatDateTime(appt.startTime);

  await sendClientPush(appt, '🕐 Es la hora de tu cita',
    `Tu cita para ${appt.Service?.name || 'Servicio'} con ${appt.Employee?.User?.name || 'Profesional'} en ${appt.Business?.name || 'Negocio'} está comenzando.`,
    'appointment_reference');

  const message = generateReferenceMessage(appt, startTimeStr);
  await scheduleWhatsAppMessage(appt, message, 'reminder');

  await appt.update({ referenceMessageSent: true });
  console.log(`[Reference] ✅ Mensaje de referencia enviado para cita ${appt.id}`);
}

async function processTechnicianReminder(appt, timeLabel, fieldToUpdate, alertEmoji) {
  const startTimeStr = formatTime(appt.startTime);

  await sendTechnicianPush(appt, `${alertEmoji} Tienes cita en ${timeLabel}`,
    `Cliente: ${appt.clientName || 'Cliente'} - ${appt.Service?.name || 'Servicio'} a las ${startTimeStr}`,
    timeLabel === '15 minutos' ? 'high' : 'normal');

  await appt.update({ [fieldToUpdate]: true });
  console.log(`[TechnicianReminder] ✅ Notificación ${timeLabel} enviada a técnico para cita ${appt.id}`);
}

module.exports = {
  processStandardReminder,
  processGenericReminder,
  processReferenceMessage,
  processTechnicianReminder,
};
