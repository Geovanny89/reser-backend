/**
 * Constantes y configuraciones para citas
 */

// Estados de citas
const APPOINTMENT_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  ATTENTION: 'attention',
  DONE: 'done',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show'
};

// Estados del flujo de mensajes
const MESSAGE_FLOW_STATUS = {
  NOT_STARTED: 'not_started',
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  AWAITING_RATING: 'awaiting_rating',
  COMPLETED: 'completed'
};

// Tipos de notificación
const NOTIFICATION_TYPES = {
  REMINDER: 'reminder',
  RATING: 'rating',
  REVIEW: 'review',
  CONFIRMATION: 'confirmation',
  CANCELLATION: 'cancellation',
  CUSTOM: 'custom',
  QUEUE_FALLBACK: 'queue_fallback'
};

// URLs de la aplicación
const APP_URLS = {
  CONFIRMATION: (appointmentId) => `https://k-dice.com/confirmar/${appointmentId}`,
  RATING: (appointmentId) => `https://k-dice.com/calificar/${appointmentId}`,
  CANCEL: (appointmentId) => `https://k-dice.com/cancelar/${appointmentId}`
};

module.exports = {
  APPOINTMENT_STATUS,
  MESSAGE_FLOW_STATUS,
  NOTIFICATION_TYPES,
  APP_URLS
};
