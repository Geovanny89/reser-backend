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
  const isConfirmed = appt.confirmed === true || appt.status === 'confirmed';

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
  const timeStr = formatTime(appt.startTime);
  const startTimeStr = formatDateTime(appt.startTime);
  const isConfirmed = appt.confirmed === true || appt.status === 'confirmed';
  const is2h = timeLabel === '2 horas';
  const is1h = timeLabel === '1 hora';
  const is15mOr30mOr1h = timeLabel === '15 minutos' || timeLabel === '30 minutos' || timeLabel === '1 hora';

  if (is1h || is2h) {
    await sendClientEmail(appt, is2h && !isConfirmed);
  }

  const message = generateGenericReminder(appt, timeLabel, timeStr, is2h, isConfirmed);
  const msgType = (is2h && !isConfirmed) ? 'confirmation' : 'reminder';
  await scheduleWhatsAppMessage(appt, message, msgType);

  await sendClientPush(appt, `⏰ Recordatorio: ${timeLabel}`,
    `Tu cita para ${appt.Service?.name || 'Servicio'} en ${appt.Business?.name || 'Negocio'} es a las ${startTimeStr}.`,
    'appointment_reminder');

  // Solo enviar push al empleado para 2h (para 15m/30m/1h se envía desde core.js)
  if (!is15mOr30mOr1h) {
    await sendEmployeePush(appt, `⏰ Recordatorio: ${timeLabel}`,
      `Cita con ${appt.clientName} (${appt.Service?.name || 'Servicio'}) a las ${startTimeStr}.`);
  }

  await appt.update({ [fieldToUpdate]: true });
  console.log(`[Reminder] ✅ Recordatorio de ${timeLabel} enviado para cita ${appt.id}`);
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
