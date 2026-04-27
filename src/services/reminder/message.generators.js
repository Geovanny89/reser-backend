/**
 * Generadores de mensajes para recordatorios
 */
const { getRandomReminderTemplate } = require('../evolutionService');
const { getRelativeDayText } = require('./time.utils');
const { REMINDER_CONFIG } = require('./config');

function getRandomTemplate(templates) {
  return templates[Math.floor(Math.random() * templates.length)];
}

function generateConfirmedReminder24h(appt, timeStr) {
  const templates = [
    `👋 Hola *${appt.clientName}*, te esperamos mañana a las *${timeStr}* para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. ¡Gracias por confirmar! 🗓️`,
    `🎯 *${appt.clientName}*, todo listo para mañana a las *${timeStr}*. Tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}* está confirmada. ¡Te esperamos! 😊`,
    `✅ Confirmado *${appt.clientName}*! Nos vemos mañana a las *${timeStr}* para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. 🗓️`,
  ];
  return getRandomTemplate(templates);
}

function generateUnconfirmedReminder24h(appt, timeStr) {
  return `👋 Hola *${appt.clientName}*, tienes una cita para *${appt.Service?.name || 'Servicio'}* mañana a las *${timeStr}* en *${appt.Business?.name || 'Negocio'}*.\n\n¿Confirmas tu asistencia?\nResponde: *SI* para confirmar\nResponde: *NO* para cancelar`;
}

function generateConfirmedReminder12h(appt, dayText) {
  const templates = [
    `👋 Hola *${appt.clientName}*, te esperamos ${dayText} para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. ¡Gracias por confirmar! 🗓️`,
    `🎯 *${appt.clientName}*, todo listo para tu cita de *${appt.Service?.name || 'Servicio'}* ${dayText} en *${appt.Business?.name || 'Negocio'}*. ¡Te esperamos con gusto! 😊`,
    `✅ Confirmado *${appt.clientName}*! Tu cita de *${appt.Service?.name || 'Servicio'}* es ${dayText} en *${appt.Business?.name || 'Negocio'}*. ¡Nos vemos pronto! 🗓️`,
  ];
  return getRandomTemplate(templates);
}

function generateUnconfirmedReminder12h(appt, dayText) {
  return `👋 Hola *${appt.clientName}*, tienes una cita para *${appt.Service?.name || 'Servicio'}* ${dayText} en *${appt.Business?.name || 'Negocio'}*.\n\n¿Confirmas tu asistencia?\nResponde: *SI* para confirmar\nResponde: *NO* para cancelar`;
}

function generateConfirmedReminder2h(appt, timeStr) {
  const templates = [
    `⏰ *${appt.clientName}*, te esperamos en 2 horas (${timeStr}) para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. ¡Todo listo! 🗓️`,
    `🎯 *${appt.clientName}*, recordatorio: tu cita confirmada es en *2 horas* (${timeStr}) en *${appt.Business?.name || 'Negocio'}*. ¡Nos vemos pronto! 😊`,
    `✅ *${appt.clientName}*, nos vemos en 2 horas (${timeStr}) para *${appt.Service?.name || 'Servicio'}*. ¡Gracias por confirmar! 🗓️`,
  ];
  return getRandomTemplate(templates);
}

function generateUnconfirmedReminder2h(appt, timeStr) {
  const template = getRandomReminderTemplate();
  const intro = template.intro
    .replace('{name}', appt.clientName)
    .replace('{service}', appt.Service?.name || 'Servicio')
    .replace('{business}', appt.Business?.name || 'Negocio')
    .replace('{time}', timeStr);
  return `${intro}\n\n${template.question}\nResponde *SI* para CONFIRMAR ✅\nResponde *NO* para CANCELAR ❌`;
}

function generateReminder1h(appt, timeStr, isConfirmed) {
  const confirmedTemplates = [
    `⏰ *${appt.clientName}*, te esperamos en 1 hora (${timeStr}) para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. ¡Todo listo! 🗓️`,
    `🎯 *${appt.clientName}*, recordatorio: tu cita confirmada es en *1 hora* (${timeStr}) en *${appt.Business?.name || 'Negocio'}*. ¡Nos vemos pronto! 😊`,
    `✅ *${appt.clientName}*, nos vemos en 1 hora (${timeStr}) para *${appt.Service?.name || 'Servicio'}*. ¡Gracias por confirmar! 🗓️`,
  ];
  const unconfirmedTemplates = [
    `⏰ *${appt.clientName}*, te esperamos en 1 hora (${timeStr}) para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. ¡No faltes! 🗓️`,
    `🎯 *${appt.clientName}*, recordatorio: tu cita es en *1 hora* (${timeStr}) en *${appt.Business?.name || 'Negocio'}*. ¡Te esperamos! 😊`,
    `📅 *${appt.clientName}*, nos vemos en 1 hora (${timeStr}) para *${appt.Service?.name || 'Servicio'}*. ¡Gracias por tu puntualidad! 🗓️`,
  ];
  return getRandomTemplate(isConfirmed ? confirmedTemplates : unconfirmedTemplates);
}

function generateGenericReminder(appt, timeLabel, timeStr, is2h, isConfirmed) {
  if (is2h && !isConfirmed) {
    return `⏰ *${appt.clientName}*, tu cita para *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}* es en *2 horas* (${timeStr}).\n\n⚠️ *IMPORTANTE:* Aún no has confirmado tu asistencia.\n\nResponde *SI* para confirmar ahora\nResponde *NO* si no podrás asistir\n\n¡Tu confirmación es importante! 🗓️`;
  }
  if (!isConfirmed && timeLabel === '1 hora') {
    return `⏰ *${appt.clientName}*, recordatorio: tu cita para *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}* es en *1 hora* (${timeStr}).\n\nNota: Aún no has confirmado tu asistencia. Por favor llega puntual.\n\n¡Te esperamos! 🗓️`;
  }
  return `⏰ *${appt.clientName}*, tu cita para *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}* es *${timeLabel}* (${timeStr}).\n\n¡Te esperamos! 🗓️`;
}

function generateReferenceMessage(appt, startTimeStr) {
  const API_URL = process.env.API_URL || 'https://api-reservas.k-dice.com';
  const statusUrl = `${API_URL}/api/appointments/${appt.id}/status`;

  return `🕐 *${appt.clientName}*, es la hora de tu cita para *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}* con *${appt.Employee?.User?.name || 'Profesional'}*.

✅ Cita confirmada - ${startTimeStr}

¡Te esperamos! 💫`;
}

function generateAppointmentCreatedMessage(appt) {
  const serviceName = appt.Service?.name || 'Servicio';
  const businessName = appt.Business?.name || 'Negocio';
  const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short', timeZone: 'America/Bogota' });
  const dateStr = new Date(appt.startTime).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });

  const templates = [
    `✅ *¡Cita Agendada!* 🎉\n\nHola *${appt.clientName}*, tu cita para *${serviceName}* en *${businessName}* ha sido confirmada.\n\n📅 Fecha: ${dateStr}\n⏰ Hora: ${timeStr}\n\n¡Te esperamos! 😊`,
    `📅 *¡Tu cita está lista!* ✨\n\n*${appt.clientName}*, hemos agendado tu cita de *${serviceName}* en *${businessName}*\n\n🗓️ ${dateStr}\n🕐 ${timeStr}\n\n¡Nos vemos pronto! 🤗`,
    `🌟 *Confirmación de Cita* ✅\n\nHola *${appt.clientName}*!\n\nTu cita para *${serviceName}* en *${businessName}* está programada:\n\n📆 ${dateStr}\n⏰ ${timeStr}\n\n¡Gracias por agendar con nosotros! 💫`,
    `✨ *¡Cita Confirmada!* 🎊\n\n*${appt.clientName}*, todo listo para tu visita a *${businessName}*\n\n💇 Servicio: *${serviceName}*\n📅 ${dateStr}\n🕐 ${timeStr}\n\n¡Te esperamos con gusto! 😄`
  ];

  return getRandomTemplate(templates);
}

module.exports = {
  generateConfirmedReminder24h,
  generateUnconfirmedReminder24h,
  generateConfirmedReminder12h,
  generateUnconfirmedReminder12h,
  generateConfirmedReminder2h,
  generateUnconfirmedReminder2h,
  generateReminder1h,
  generateGenericReminder,
  generateReferenceMessage,
  generateAppointmentCreatedMessage,
};
