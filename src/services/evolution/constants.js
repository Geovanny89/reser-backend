/**
 * Constantes de configuración para Evolution API
 * Archivo: evolution/constants.js
 */

// ==================== CONFIGURACIÓN DE LÍMITES ====================

/** Límite de mensajes por hora por negocio */
const MAX_MESSAGES_PER_HOUR = 20;

// ==================== TEMPLATES DE MENSAJES ====================

const CONFIRMATION_TEMPLATES = [
  '✅ ¡Perfecto! Tu cita ha sido confirmada. Te esperamos 😊',
  '🎉 ¡Listo! Asistencia confirmada. ¡Gracias por elegirnos! 🙏',
  '👍 ¡Confirmado! Tu cita está agendada. ¡Nos vemos pronto!',
  '✨ ¡Excelente! Tu asistencia ha sido registrada. Te esperamos con gusto 💫',
  '📅 ¡Confirmado! Gracias por confirmar tu cita. ¡Hasta luego! 👋',
  '💯 ¡Todo listo! Cita confirmada exitosamente. ¡Gracias! 🌟',
  '🤝 ¡Gracias por confirmar! Te esperamos en tu cita programada.',
  '👌 ¡Perfecto! Asistencia confirmada. ¡Que tengas un excelente día! ☀️'
];

const REMINDER_TEMPLATES = [
  { intro: 'Hola *{name}*, te recordamos tu cita de *{service}* en *{business}* para hoy a las *{time}*.', question: '¿Confirmas tu asistencia?' },
  { intro: '👋 *{name}*, recordatorio: tienes cita de *{service}* hoy a las *{time}* en *{business}*.', question: '¿Asistirás?' },
  { intro: '⏰ *{name}*, tu cita de *{service}* en *{business}* es hoy a las *{time}*.', question: '¿Podrás asistir?' },
  { intro: '📅 Hola *{name}*, te escribimos de *{business}* para recordarte tu cita de *{service}* hoy a las *{time}*.', question: '¿Vas a poder ir?' },
  { intro: '✨ *{name}*, recordatorio de tu cita de *{service}* en *{business}* para las *{time}* de hoy.', question: '¿Confirmas asistencia?' }
];

const RATING_TEMPLATES = [
  '⭐ ¿Cómo fue tu experiencia? Responde con una calificación del 1 al 5. ¡Tu opinión nos ayuda!',
  '🌟 ¡Esperamos que todo haya salido bien! ¿Nos calificarías del 1 al 5? Tu feedback es valioso 💬',
  '💫 ¿Cómo te fue en tu visita? Responde del 1 al 5 y ayúdanos a mejorar. ¡Gracias! 🙏',
  '😊 Esperamos que hayas tenido una excelente experiencia. ¿Nos das una calificación del 1 al 5?',
  '👋 ¿Cómo estuvo tu cita? Tu calificación del 1 al 5 nos ayuda mucho. ¡Gracias por confiar en nosotros!'
];

const RATING_THANKS_TEMPLATES = [
  (rating) => `🌟 ¡Gracias por calificar con ${'⭐'.repeat(rating)}! Nos ayuda mucho.`,
  (rating) => `💫 ¡Excelente! Gracias por tu ${'⭐'.repeat(rating)}. Tu opinión nos hace mejores.`,
  (rating) => `🙏 ¡Agradecemos tu ${'⭐'.repeat(rating)}! Gracias por tomarte el tiempo de calificarnos.`,
  (rating) => `⭐⭐⭐ ¡Genial! Tu calificación de ${rating} estrellas ha sido guardada. ¡Gracias!`,
  (rating) => `🎉 ¡Perfecto! Gracias por tu ${'⭐'.repeat(rating)}. Tu feedback es muy valioso para nosotros.`
];

const CANCEL_TEMPLATES = [
  '✅ Cita cancelada exitosamente.',
  '👍 Confirmamos la cancelación. ¡Hasta pronto!',
  '📅 Cita cancelada. Escríbenos si necesitas reagendar.'
];

const THANK_YOU_TEMPLATES = (clientName) => [
  `🙏 ¡Hola de nuevo *${clientName}*! Queríamos agradecerte por tomarte el tiempo de calificar nuestro servicio. Tu opinión nos ayuda a mejorar cada día. ¡Te esperamos pronto! ✨`,
  `💫 *${clientName}*, gracias por tu calificación. Valoramos mucho tu feedback y trabajamos constantemente para ofrecerte la mejor experiencia. ¡Hasta la próxima! 🌟`,
  `🎉 ¡Gracias *${clientName}*! Tu calificación ha sido recibida. Nos motiva a seguir dando lo mejor. ¡Que tengas un excelente día! ☀️`
];

// ==================== EXPORTS ====================

module.exports = {
  MAX_MESSAGES_PER_HOUR,
  CONFIRMATION_TEMPLATES,
  REMINDER_TEMPLATES,
  RATING_TEMPLATES,
  RATING_THANKS_TEMPLATES,
  CANCEL_TEMPLATES,
  THANK_YOU_TEMPLATES
};
