/**
 * API Pública del Scheduler
 */
const { ScheduledMessage, sequelize } = require('../../models');
const { adjustToBusinessHours } = require('./time.utils');
const { cancelAppointmentMessages } = require('./message.queries');

/**
 * Programa un mensaje para ser enviado más tarde
 */
async function scheduleMessage({ businessId, appointmentId, phone, message, type, scheduledAt }) {
  try {
    console.log(`[Scheduler] 📅 Mensaje programado: ${type} para ${phone} a las ${scheduledAt}`);

    const adjustedScheduledAt = adjustToBusinessHours(new Date(scheduledAt));

    const scheduled = await ScheduledMessage.create({
      businessId,
      appointmentId,
      phone,
      message,
      type,
      scheduledAt: adjustedScheduledAt,
      status: 'pending',
      retryCount: 0,
    });

    console.log(`[Scheduler] ✅ Mensaje guardado en BD: ${scheduled.id}`);
    return scheduled;
  } catch (error) {
    console.error('[Scheduler] ❌ Error programando mensaje:', error.message);
    throw error;
  }
}

/**
 * Obtiene estadísticas de mensajes programados
 */
async function getStats(businessId = null) {
  const where = businessId ? { businessId } : {};

  const stats = await ScheduledMessage.findAll({
    where,
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });

  return stats;
}

module.exports = {
  scheduleMessage,
  cancelAppointmentMessages,
  getStats,
};
