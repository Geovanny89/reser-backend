/**
 * Constantes de configuración para Evolution API
 * Archivo: evolution/constants.js
 */

// ==================== CONFIGURACIÓN DE API ====================
const BASE_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY || '1234';
const DEFAULT_TOKEN = process.env.EVOLUTION_API_TOKEN || '1234';

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
  '👌 ¡Perfecto! Asistencia confirmada. ¡Que tengas un excelente día! ☀️',
  '🔔 ¡Confirmación recibida! Tu cita está lista. ¡Te esperamos! 🎊',
  '💪 ¡Genial! Asistencia confirmada. ¡Nos vemos en tu cita! 🌈',
  '🎯 ¡Todo en orden! Cita confirmada. ¡Gracias por tu respuesta! 🙌',
  '🌟 ¡Fantástico! Tu asistencia ha sido registrada. ¡Te esperamos! ✨',
  '📌 ¡Anotado! Cita confirmada. ¡Hasta pronto! 🎈',
  '🎁 ¡Gracias! Tu confirmación ha sido procesada. ¡Te esperamos! 🌸',
  '🏆 ¡Excelente! Cita confirmada. ¡Nos vemos! 🎉',
  '🌻 ¡Perfecto! Asistencia confirmada. ¡Que tengas un gran día! ☀️',
  '🎪 ¡Listo! Tu cita está confirmada. ¡Gracias! 🎭',
  '💎 ¡Confirmado! Te esperamos en tu cita. ¡Hasta luego! ✨',
  '🎨 ¡Genial! Asistencia confirmada. ¡Nos vemos pronto! 🖼️',
  '🎵 ¡Todo listo! Cita confirmada. ¡Gracias por elegirnos! 🎶'
];

const REMINDER_TEMPLATES = [
  { intro: 'Hola *{name}*, te recordamos tu cita de *{service}* en *{business}* para hoy a las *{time}*.', question: '¿Confirmas tu asistencia?' },
  { intro: '👋 *{name}*, recordatorio: tienes cita de *{service}* hoy a las *{time}* en *{business}*.', question: '¿Asistirás?' },
  { intro: '⏰ *{name}*, tu cita de *{service}* en *{business}* es hoy a las *{time}*.', question: '¿Podrás asistir?' },
  { intro: '📅 Hola *{name}*, te escribimos de *{business}* para recordarte tu cita de *{service}* hoy a las *{time}*.', question: '¿Vas a poder ir?' },
  { intro: '✨ *{name}*, recordatorio de tu cita de *{service}* en *{business}* para las *{time}* de hoy.', question: '¿Confirmas asistencia?' },
  { intro: '🔔 *{name}*, nos vemos hoy a las *{time}* para tu cita de *{service}* en *{business}*.', question: '¿Confirmas?' },
  { intro: '🎯 *{name}*, tu cita de *{service}* es hoy a las *{time}* en *{business}*.', question: '¿Vienes?' },
  { intro: '🌟 *{name}*, recordatorio: cita de *{service}* hoy *{time}* en *{business}*.', question: '¿Podrás asistir?' },
  { intro: '📌 *{name}*, te esperamos hoy a las *{time}* para *{service}* en *{business}*.', question: '¿Confirmas?' },
  { intro: '💫 *{name}*, tu cita de *{service}* es hoy *{time}* en *{business}*.', question: '¿Asistirás?' },
  { intro: '🎪 *{name}*, recordatorio: cita de *{service}* hoy *{time}* en *{business}*.', question: '¿Vas a poder ir?' },
  { intro: '🎁 *{name}*, nos vemos hoy a las *{time}* para *{service}* en *{business}*.', question: '¿Confirmas asistencia?' },
  { intro: '🏆 *{name}*, tu cita de *{service}* es hoy *{time}* en *{business}*.', question: '¿Podrás venir?' },
  { intro: '🌻 *{name}*, recordatorio: cita de *{service}* hoy *{time}* en *{business}*.', question: '¿Confirmas?' },
  { intro: '🎨 *{name}*, te esperamos hoy a las *{time}* para *{service}* en *{business}*.', question: '¿Asistirás?' }
];

const RATING_TEMPLATES = [
  '⭐ ¿Cómo fue tu experiencia? Responde con una calificación del 1 al 5. ¡Tu opinión nos ayuda!',
  '🌟 ¡Esperamos que todo haya salido bien! ¿Nos calificarías del 1 al 5? Tu feedback es valioso 💬',
  '💫 ¿Cómo te fue en tu visita? Responde del 1 al 5 y ayúdanos a mejorar. ¡Gracias! 🙏',
  '😊 Esperamos que hayas tenido una excelente experiencia. ¿Nos das una calificación del 1 al 5?',
  '👋 ¿Cómo estuvo tu cita? Tu calificación del 1 al 5 nos ayuda mucho. ¡Gracias por confiar en nosotros!',
  '🎯 ¿Qué tal estuvo tu servicio? Califícanos del 1 al 5. ¡Tu opinión es importante! 🌈',
  '🔔 ¡Hola! ¿Nos das una calificación del 1 al 5? Nos ayuda a mejorar cada día ✨',
  '🎁 ¿Cómo te fue? Responde del 1 al 5. ¡Gracias por tu tiempo! 🙌',
  '🏆 ¿Fue todo de tu agrado? Califícanos del 1 al 5. ¡Tu feedback nos hace mejores! 💪',
  '🌻 ¿Cómo estuvo tu experiencia? Del 1 al 5 por favor. ¡Gracias por elegirnos! ☀️',
  '🎪 ¿Qué tal? Califícanos del 1 al 5. ¡Tu opinión nos ayuda a crecer! 🎭',
  '💎 ¿Cómo estuvo tu cita? Del 1 al 5. ¡Gracias por confiar en nosotros! ✨',
  '🎨 ¿Fue todo bien? Califícanos del 1 al 5. ¡Tu feedback es valioso! 🖼️',
  '🎵 ¿Cómo te fue? Del 1 al 5 por favor. ¡Nos ayuda a mejorar! 🎶',
  '🎊 ¿Qué tal tu experiencia? Califícanos del 1 al 5. ¡Gracias! 🎉'
];

const RATING_THANKS_TEMPLATES = [
  (rating) => `🌟 ¡Gracias por calificar con ${'⭐'.repeat(rating)}! Nos ayuda mucho.`,
  (rating) => `💫 ¡Excelente! Gracias por tu ${'⭐'.repeat(rating)}. Tu opinión nos hace mejores.`,
  (rating) => `🙏 ¡Agradecemos tu ${'⭐'.repeat(rating)}! Gracias por tomarte el tiempo de calificarnos.`,
  (rating) => `⭐⭐⭐ ¡Genial! Tu calificación de ${rating} estrellas ha sido guardada. ¡Gracias!`,
  (rating) => `🎉 ¡Perfecto! Gracias por tu ${'⭐'.repeat(rating)}. Tu feedback es muy valioso para nosotros.`,
  (rating) => `🎯 ¡Gracias por tus ${'⭐'.repeat(rating)}! Nos ayuda a mejorar cada día 🌈`,
  (rating) => `🔔 ¡Agradecemos tu calificación de ${'⭐'.repeat(rating)}! ¡Gracias! ✨`,
  (rating) => `🎁 ¡Gracias por tus ${'⭐'.repeat(rating)}! Tu opinión es importante 🙌`,
  (rating) => `🏆 ¡Excelente! Gracias por calificar con ${'⭐'.repeat(rating)}. ¡Nos hace mejores! 💪`,
  (rating) => `🌻 ¡Gracias por tus ${'⭐'.repeat(rating)}! Valoramos mucho tu feedback ☀️`,
  (rating) => `🎪 ¡Genial! Tu ${'⭐'.repeat(rating)} ha sido registrada. ¡Gracias! 🎭`,
  (rating) => `💎 ¡Gracias por calificar con ${'⭐'.repeat(rating)}! ¡Gracias por confiar en nosotros! ✨`,
  (rating) => `🎨 ¡Agradecemos tus ${'⭐'.repeat(rating)}! Tu feedback es valioso 🖼️`,
  (rating) => `🎵 ¡Gracias por tu calificación de ${'⭐'.repeat(rating)}! ¡Nos ayuda a mejorar! 🎶`,
  (rating) => `🎊 ¡Perfecto! Gracias por tus ${'⭐'.repeat(rating)}. ¡Gracias! 🎉`
];

const CANCEL_TEMPLATES = [
  '✅ Cita cancelada exitosamente.',
  '👍 Confirmamos la cancelación. ¡Hasta pronto!',
  '📅 Cita cancelada. Escríbenos si necesitas reagendar.',
  '🔔 Cita cancelada. ¡Gracias por avisarnos! ✨',
  '🎯 Cancelación confirmada. ¡Te esperamos pronto! 🌈',
  '🎁 Cita cancelada. Escríbenos cuando quieras reagendar 🙌',
  '🏆 Cita cancelada exitosamente. ¡Gracias! 💪',
  '🌻 Cita cancelada. ¡Hasta pronto! ☀️',
  '🎪 Confirmamos la cancelación. ¡Nos vemos! 🎭',
  '💎 Cita cancelada. ¡Gracias por avisar! ✨'
];

const THANK_YOU_TEMPLATES = (clientName) => [
  `🙏 ¡Hola de nuevo *${clientName}*! Queríamos agradecerte por tomarte el tiempo de calificar nuestro servicio. Tu opinión nos ayuda a mejorar cada día. ¡Te esperamos pronto! ✨`,
  `💫 *${clientName}*, gracias por tu calificación. Valoramos mucho tu feedback y trabajamos constantemente para ofrecerte la mejor experiencia. ¡Hasta la próxima! 🌟`,
  `🎉 ¡Gracias *${clientName}*! Tu calificación ha sido recibida. Nos motiva a seguir dando lo mejor. ¡Que tengas un excelente día! ☀️`,
  `🎯 ¡Gracias *${clientName}*! Tu opinión nos ayuda a mejorar. ¡Te esperamos pronto! 🌈`,
  `🔔 *${clientName}*, agradecemos tu calificación. ¡Gracias por tu tiempo! ✨`,
  `🎁 ¡Hola *${clientName}*! Gracias por calificarnos. Tu feedback es valioso 🙌`,
  `🏆 *${clientName}*, gracias por tu opinión. ¡Nos hace mejores! 💪`,
  `🌻 ¡Gracias *${clientName}*! Valoramos mucho tu feedback ☀️`,
  `🎪 *${clientName}*, gracias por calificar. ¡Nos vemos pronto! 🎭`,
  `💎 ¡Gracias *${clientName}*! Tu opinión es importante ✨`
];

// ==================== EXPORTS ====================

module.exports = {
  BASE_URL,
  API_KEY,
  DEFAULT_TOKEN,
  MAX_MESSAGES_PER_HOUR,
  CONFIRMATION_TEMPLATES,
  REMINDER_TEMPLATES,
  RATING_TEMPLATES,
  RATING_THANKS_TEMPLATES,
  CANCEL_TEMPLATES,
  THANK_YOU_TEMPLATES
};
