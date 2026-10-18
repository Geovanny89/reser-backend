/**
 * Generadores de mensajes para recordatorios con lógica Anti-Baneo
 * Optimizados para variar estructura, longitud y simular comportamiento humano.
 */
const { getRelativeDayText } = require('./time.utils');

/**
 * Construye un texto con todos los servicios de la cita:
 * el servicio principal + los servicios extra (extraServices).
 * Ej: "Corte de cabello, Arreglo de uñas"
 */
function buildServicesText(appt) {
  const main = appt.Service?.name || 'Servicio';
  const extras = Array.isArray(appt.extraServices) && appt.extraServices.length > 0
    ? appt.extraServices.map(s => s.name).filter(Boolean)
    : [];
  return extras.length > 0 ? `${main} - ${extras.join(' - ')}` : main;
}

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
 * Añade una variación invisible o sutil para hacer el mensaje único.
 * Simula "micro-errores" o inconsistencias humanas en puntuación y espacios.
 */
function addUniqueFingerprint(text) {
  const punctuation = ['', '.', '!', '!!', '...', ''];
  const emojis = ['😊', '✨', '💫', '👍', '📅', '✅', '👋', '🎯', '🌟', '📌', '🎈', '🙌'];
  
  // Decidir variaciones sutiles
  const p = punctuation[Math.floor(Math.random() * punctuation.length)];
  const e = Math.random() > 0.4 ? emojis[Math.floor(Math.random() * emojis.length)] : '';
  const spaceBeforeEmoji = Math.random() > 0.5 ? ' ' : '';
  const invisibleChar = Math.random() > 0.8 ? '\u200B' : ''; 

  // Simular "error" de puntuación o falta de ella al final
  let result = text.trim();
  if (Math.random() > 0.7 && (result.endsWith('.') || result.endsWith('!'))) {
    result = result.slice(0, -1); // Quitar el signo final a veces
  }

  return `${result}${p}${spaceBeforeEmoji}${invisibleChar}${e}`;
}

function getRandomTemplate(templates) {
  const template = templates[Math.floor(Math.random() * templates.length)];
  const processed = addUniqueFingerprint(processSpintax(template));
  // WhatsApp usa un solo asterisco (*) para negrita.
  // Reemplazamos cualquier doble asterisco accidental (**) por uno solo (*)
  return processed.replace(/\*\*/g, '*');
}

function generateConfirmedReminder24h(appt, timeStr) {
  const services = buildServicesText(appt);
  const templates = [
    `{👋 Hola|Buen día} *${appt.clientName}*, te esperamos mañana a las *${timeStr}* para tu cita de *${services}* en *${appt.Business?.name || 'Negocio'}*.`,
    `🎯 *Todo listo*: Mañana a las *${timeStr}* es tu cita de *${services}*. *${appt.clientName}*, ¡te esperamos en ${appt.Business?.name || 'nuestro local'}!`,
    `✅ *Cita confirmada*: Mañana a las *${timeStr}* nos vemos para *${services}*. ¡Gracias por preferir *${appt.Business?.name}*!`,
    `Mañana tienes programado *${services}* a las *${timeStr}*. *${appt.clientName}*, te recordamos que tu cita ya está confirmada.`
  ];
  return getRandomTemplate(templates);
}

function generateUnconfirmedReminder24h(appt, timeStr) {
  const services = buildServicesText(appt);
  const cta = `{Responde *SI* para confirmar|Confirma con un *SI*|Por favor dinos si asistirás (*SI*/*NO*)|¿Nos confirmas con un *SI*?|Responde *SI* (confirmar) o *NO* (cancelar)}`;
  const templates = [
    `{👋 Hola|Saludos} *${appt.clientName}*, {tienes|te recordamos} tu cita para *${services}* mañana a las *${timeStr}*.\n\n${cta}`,
    `⚠️ *Recordatorio*: Mañana a las *${timeStr}* tienes programado *${services}* en *${appt.Business?.name}*.\n\n${cta}`,
    `🗓️ *${appt.clientName}*, ¿confirmas tu cita de mañana a las *${timeStr}* para *${services}*?\n\n${cta}`,
    `Tu espacio para *${services}* está reservado para mañana a las *${timeStr}*. *${appt.clientName}*, ¿vas a poder asistir?\n\n${cta}`
  ];
  return getRandomTemplate(templates);
}

function generateConfirmedReminder12h(appt, dayText) {
  const services = buildServicesText(appt);
  const templates = [
    `{👋 Hola|Buen día} *${appt.clientName}*, te esperamos ${dayText} a las *${new Date(appt.startTime).toLocaleTimeString('es-CO', {timeStyle: 'short', timeZone: 'America/Bogota'})}* para *${services}*.`,
    `🎯 *${appt.clientName}*, todo listo para tu cita de ${dayText} en *${appt.Business?.name}*. ¡Nos vemos pronto!`,
    `✅ Tu cita de *${services}* es ${dayText}. ¡Te esperamos con gusto!`,
    `Recordatorio: ${dayText} nos vemos para tu servicio de *${services}*.`
  ];
  return getRandomTemplate(templates);
}

function generateUnconfirmedReminder12h(appt, dayText) {
  const services = buildServicesText(appt);
  const cta = `{Confirma con un *SI* por favor|Responde *SI* para asegurar tu lugar|¿Asistirás? Responde *SI* o *NO*|Dinos si vienes con un *SI*|Responde *SI* para confirmar}`;
  const templates = [
    `{👋 Hola|Buen día} *${appt.clientName}*, {tienes|recordamos tu} cita para *${services}* ${dayText}.\n\n${cta}`,
    `🚨 *Aviso*: Tu cita de *${services}* es ${dayText} en *${appt.Business?.name}*.\n\n${cta}`,
    `🗓️ *${appt.clientName}*, falta confirmar tu visita ${dayText} para *${services}*.\n\n${cta}`,
    `¿Asistirás ${dayText} a tu cita de *${services}*? ${cta}`
  ];
  return getRandomTemplate(templates);
}

function generateConfirmedReminder2h(appt, timeStr) {
  const services = buildServicesText(appt);
  const templates = [
    `⏰ *${appt.clientName}*, te esperamos hoy a las *${timeStr}* para *${services}*. ¡Ya falta poco!`,
    `🎯 Hoy a las *${timeStr}* es tu cita de *${services}*. ¡Todo listo para recibirte!`,
    `✅ *${appt.clientName}*, recordatorio: tu cita confirmada es hoy a las *${timeStr}*.`,
    `¡Ya casi! Hoy a las *${timeStr}* comenzamos con tu cita de *${services}*. ¡Te esperamos!`
  ];
  return getRandomTemplate(templates);
}

function generateUnconfirmedReminder2h(appt, timeStr) {
  const services = buildServicesText(appt);
  const templates = [
    `⏰ *${appt.clientName}*, te recordamos tu cita de *${services}* hoy a las *${timeStr}*.`,
    `🎯 *Aviso*: Hoy a las *${timeStr}* es tu cita de *${services}* en *${appt.Business?.name}*.`,
    `🔔 *${appt.clientName}*, te recordamos tu cita de las *${timeStr}*. ¡Te esperamos pronto!`,
    `Tu cita para *${services}* es hoy a las *${timeStr}*. ¡No olvides llegar puntual!`
  ];
  return getRandomTemplate(templates);
}

function generateReminder1h(appt, timeStr, isConfirmed) {
  const services = buildServicesText(appt);
  const confirmedTemplates = [
    `⏰ *${appt.clientName}*, te esperamos en 1 hora (${timeStr}) para *${services}*. ¡Todo listo!`,
    `🎯 *Recordatorio*: Tu cita confirmada es en 1 hora (${timeStr}). ¡Nos vemos pronto!`,
    `✅ *${appt.clientName}*, nos vemos en 1 hora para tu servicio de *${services}*.`,
    `¡Falta solo una hora! Todo preparado para recibirte en *${appt.Business?.name}*.`
  ];
  
  const unconfirmedTemplates = [
    `⏰ *${appt.clientName}*, tu cita para *${services}* es en solo 1 hora (${timeStr}). ¡No faltes!`,
    `🚨 *Aviso importante*: Tu cita comienza en 60 minutos. *${appt.clientName}*, te esperamos puntualmente.`,
    `⏳ Solo falta una hora para tu servicio de *${services}*. ¿Ya vienes en camino?`,
    `Recordatorio urgente: Tu cita es a las *${timeStr}*. Por favor llega puntual a *${appt.Business?.name}*.`
  ];

  return getRandomTemplate(isConfirmed ? confirmedTemplates : unconfirmedTemplates);
}

function generateGenericReminder(appt, timeLabel, timeStr, is2h, isConfirmed) {
  const services = buildServicesText(appt);
  const templates = [
    `⏰ *${appt.clientName}*, tu cita para *${services}* es *${timeLabel}* (${timeStr}).`,
    `🎯 *Recordatorio*: Tu cita es *${timeLabel}* (${timeStr}) para *${services}*.`,
    `📅 *${appt.clientName}*, {falta poco|te recordamos} tu cita *${timeLabel}* (${timeStr}).`,
    `{Hola|Buen día} *${appt.clientName}*, te esperamos en *${timeLabel}* para tu cita.`
  ];
  return getRandomTemplate(templates);
}

function generateReferenceMessage(appt, startTimeStr) {
  const services = buildServicesText(appt);
  return `🕐 *${appt.clientName}*, es la hora de tu cita para *${services}*.
  
✅ Cita confirmada - ${startTimeStr}

¡Te esperamos!`;
}

function generateAppointmentCreatedMessage(appt) {
  const serviceName = buildServicesText(appt);
  const businessName = appt.Business?.name || 'Negocio';
  const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short', timeZone: 'America/Bogota' });
  const dateStr = new Date(appt.startTime).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });

  const templates = [
    `{✅|🗓️} *Cita Agendada* 🎉\n\n*${appt.clientName}*, tu cita para *${serviceName}* en *${businessName}* ha sido programada.\n\n📅 ${dateStr}\n⏰ ${timeStr}\n\n¡Te esperamos!`,
    `📅 *¡Listo! Tu cita está agendada*\n\n*${appt.clientName}*, te esperamos para *${serviceName}* en *${businessName}*.\n\n🗓️ ${dateStr}\n🕐 ${timeStr}\n\n¡Te esperamos!`,
    `🌟 *Reserva Confirmada* ✅\n\n*${appt.clientName}*, hemos registrado tu cita de *${serviceName}*:\n\n📆 ${dateStr}\n⏰ ${timeStr}\n\n¡Gracias por preferir *${businessName}*!`,
    `🗓️ *Cita Programada*\n\n*${appt.clientName}*, tu cita para *${serviceName}* en *${businessName}* ya está en nuestra agenda.\n\n📅 ${dateStr}\n⏰ ${timeStr}\n\n¡Nos vemos pronto!`
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
