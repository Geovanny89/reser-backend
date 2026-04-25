/**
 * Templates de mensajes para Evolution API
 * Archivo: evolution/templates.js
 */

const {
  CONFIRMATION_TEMPLATES,
  REMINDER_TEMPLATES,
  RATING_TEMPLATES,
  RATING_THANKS_TEMPLATES,
  CANCEL_TEMPLATES,
  THANK_YOU_TEMPLATES
} = require('./constants');

function getRandomConfirmationTemplate() {
  return CONFIRMATION_TEMPLATES[Math.floor(Math.random() * CONFIRMATION_TEMPLATES.length)];
}

function getRandomReminderTemplate() {
  return REMINDER_TEMPLATES[Math.floor(Math.random() * REMINDER_TEMPLATES.length)];
}

function getRandomRatingTemplate() {
  return RATING_TEMPLATES[Math.floor(Math.random() * RATING_TEMPLATES.length)];
}

function getRandomRatingThanksTemplate(rating) {
  const template = RATING_THANKS_TEMPLATES[Math.floor(Math.random() * RATING_THANKS_TEMPLATES.length)];
  return template(rating);
}

function getRandomCancelTemplate() {
  return CANCEL_TEMPLATES[Math.floor(Math.random() * CANCEL_TEMPLATES.length)];
}

function getRandomThankYouTemplate(clientName) {
  const templates = THANK_YOU_TEMPLATES(clientName);
  return templates[Math.floor(Math.random() * templates.length)];
}

module.exports = {
  getRandomConfirmationTemplate,
  getRandomReminderTemplate,
  getRandomRatingTemplate,
  getRandomRatingThanksTemplate,
  getRandomCancelTemplate,
  getRandomThankYouTemplate
};
