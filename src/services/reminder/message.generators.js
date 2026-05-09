/**
 * Generadores de mensajes para recordatorios con lógica Anti-Baneo
 */
const { getRelativeDayText } = require('./time.utils');

/**
 * Procesa Spintax: {Hola|Buen día|Saludos} -> selecciona uno al azar
 */
function processSpintax(text) {
  return text.replace(/{([^{}]+)}/g, (match, options) => {
    const choices = options.split('|');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

/**
 * Añade una variación invisible o sutil para hacer el mensaje único sin que el cliente lo note
 */
function addUniqueFingerprint(text) {
  const punctuation = ['', '.', '..', '!'];
  const spaces = ['', ' ', '\u200B', ' \u200B']; // \u200B es un espacio de ancho cero (invisible)
  const emojis = ['😊', '✨', '💫', '👍', '📅', '✅', '👋', '🎯', '💫', '🌟'];
  
  const p = punctuation[Math.floor(Math.random() * punctuation.length)];
  const s = spaces[Math.floor(Math.random() * spaces.length)];
  const e = emojis[Math.floor(Math.random() * emojis.length)];
  
  // Retornar el texto con variaciones que el ojo humano casi no nota pero el algoritmo sí
  return `${text}${p}${s}${e}`;
}

function getRandomTemplate(templates) {
  const template = templates[Math.floor(Math.random() * templates.length)];
  return addUniqueFingerprint(processSpintax(template));
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
  const templates = [
    `{👋 Hola|Saludos|Buen día} *${appt.clientName}*, {tienes|te recordamos que tienes} una cita para *${appt.Service?.name || 'Servicio'}* mañana a las *${timeStr}* en *${appt.Business?.name || 'Negocio'}*.\n\n¿{Confirmas|Podrás confirmar} tu asistencia?\nResponde: *SI* para confirmar\nResponde: *NO* para cancelar`,
    `⚠️ *Recordatorio de Cita*: *${appt.clientName}*, mañana a las *${timeStr}* tienes programado *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*.\n\nPor favor, {ayúdanos|confírmanos} respondiendo:\n*SI* (Confirmar)\n*NO* (Cancelar)`,
    `🗓️ {Hola|Buen día} *${appt.clientName}*, {queremos confirmar|te escribimos para confirmar} tu cita de mañana a las *${timeStr}* para *${appt.Service?.name || 'Servicio'}*.\n\n{¿Asistirás?|¿Confirmas?} Responde *SI* o *NO* por favor.`
  ];
  return getRandomTemplate(templates);
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
  const templates = [
    `{👋 Hola|Buen día} *${appt.clientName}*, {tienes|recordamos tu} cita para *${appt.Service?.name || 'Servicio'}* ${dayText} en *${appt.Business?.name || 'Negocio'}*.\n\n¿Confirmas tu asistencia?\nResponde: *SI* para confirmar\nResponde: *NO* para cancelar`,
    `🚨 *Aviso de Cita*: *${appt.clientName}*, tu cita de *${appt.Service?.name || 'Servicio'}* es ${dayText} en *${appt.Business?.name || 'Negocio'}*.\n\nPor favor {confirma|respóndenos} con *SI* o *NO* para asegurar tu lugar.`,
    `🗓️ *${appt.clientName}*, {queremos confirmar|falta confirmar} tu visita ${dayText} para *${appt.Service?.name || 'Servicio'}*.\n\n{Responde|Por favor responde} *SI* o *NO* para {validar|gestionar} tu espacio.`
  ];
  return getRandomTemplate(templates);
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
  const { getRandomReminderTemplate } = require('../evolutionService');
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
    const templates = [
      `⏰ *${appt.clientName}*, tu cita para *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}* es en *2 horas* (${timeStr}).\n\n⚠️ *IMPORTANTE:* Aún no has confirmado tu asistencia.\n\nResponde *SI* para confirmar ahora\nResponde *NO* si no podrás asistir`,
      `⏳ {Recordatorio|Atención} *${appt.clientName}*: En *2 horas* (${timeStr}) tienes tu cita de *${appt.Service?.name || 'Servicio'}*.\n\n{Pendiente:|Aviso:} No hemos recibido tu confirmación.\n\nPor favor responde *SI* o *NO*.`,
      `📅 *${appt.clientName}*, en solo 2 horas (${timeStr}) es tu cita. {Por favor|Necesitamos que} confirmes tu asistencia respondiendo *SI* o *NO* ahora mismo.`
    ];
    return getRandomTemplate(templates);
  }
  if (!isConfirmed && timeLabel === '1 hora') {
    const templates = [
      `⏰ *${appt.clientName}*, recordatorio: tu cita para *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}* es en *1 hora* (${timeStr}).\n\nNota: Aún no has confirmado tu asistencia. Por favor llega puntual.`,
      `🛑 *Último aviso*: *${appt.clientName}*, tu cita es en *1 hora* (${timeStr}).\n\nNo has confirmado, pero {te esperamos|contamos con tu asistencia}. Por favor llega a tiempo.`,
      `🔔 *Recordatorio final*: *${appt.clientName}*, nos vemos en 1 hora (${timeStr}) para *${appt.Service?.name || 'Servicio'}*. No olvides {tu cita|llegar puntual}.`
    ];
    return getRandomTemplate(templates);
  }
  
  const defaultTemplates = [
    `⏰ *${appt.clientName}*, tu cita para *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}* es *${timeLabel}* (${timeStr}).\n\n¡{Te esperamos|Nos vemos pronto}! 🗓️`,
    `🎯 *Recordatorio*: *${appt.clientName}*, tu cita es *${timeLabel}* (${timeStr}) para *${appt.Service?.name || 'Servicio'}*.\n\n{¡Gracias por tu puntualidad!|¡Todo listo para recibirte!}`,
    `📅 *${appt.clientName}*, {falta poco|te recordamos} tu cita *${timeLabel}* (${timeStr}) en *${appt.Business?.name || 'Negocio'}*.`
  ];
  return getRandomTemplate(defaultTemplates);
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
    `{✅|🗓️|✨} *¡Cita Agendada con éxito!* 🎉\n\n{Hola|Buen día} *${appt.clientName}*, {te informamos que|confirmamos que} tu cita para *${serviceName}* en *${businessName}* ha sido {programada|agendada}.\n\n📅 {Fecha|Día}: ${dateStr}\n⏰ {Hora}: ${timeStr}\n\n¡Te esperamos! {😊|💫}`,
    `📅 *¡Tu cita ya está lista!* ✨\n\n*${appt.clientName}*, hemos {agendado|registrado} tu cita de *${serviceName}* en *${businessName}*\n\n🗓️ ${dateStr}\n🕐 ${timeStr}\n\n¡{Nos vemos pronto|Te esperamos}! {🤗|✨}`,
    `🌟 *{Reserva|Cita} Agendada* ✅\n\n{Hola|Saludos} *${appt.clientName}*!\n\nTu cita para *${serviceName}* en *${businessName}* ya está {programada|en agenda}:\n\n📆 ${dateStr}\n⏰ ${timeStr}\n\n¡Gracias por {agendar|preferirnos}! {💫|🌟}`,
    `✨ *¡Cita Programada!* 🎊\n\n*${appt.clientName}*, {todo listo para|tu espacio está listo para} tu visita a *${businessName}*\n\n💅 Servicio: *${serviceName}*\n📅 ${dateStr}\n🕐 ${timeStr}\n\n¡{Te esperamos con gusto|Nos vemos pronto}! {😄|✨}`
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
  getRandomTemplate,
};
