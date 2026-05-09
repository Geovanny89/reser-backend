/**
 * Acciones externas del scheduler estándar
 */

const { ScheduledMessage, IncomingMessage, sequelize } = require('../../../models');
const { Op } = require('sequelize');
const utils = require('./utils');

/**
 * Programar un mensaje para ser enviado más tarde
 */
async function scheduleMessage({ businessId, appointmentId, phone, message, type, scheduledAt }) {
  try {
    console.log(`[Scheduler] 📅 Mensaje programado: ${type} para ${phone} a las ${scheduledAt}`);

    if (appointmentId && type) {
      const existingMessage = await ScheduledMessage.findOne({
        where: {
          appointmentId,
          type,
          status: { [Op.in]: ['pending', 'sent'] }
        }
      });

      if (existingMessage) {
        console.log(`[Scheduler] ⚠️ Mensaje duplicado detectado para cita ${appointmentId}. Saltando...`);
        return existingMessage;
      }
    }

    const adjustedScheduledAt = utils.adjustToBusinessHours(new Date(scheduledAt));

    const scheduled = await ScheduledMessage.create({
      businessId,
      appointmentId,
      phone,
      message,
      type,
      scheduledAt: adjustedScheduledAt,
      status: 'pending',
      retryCount: 0
    });

    return scheduled;
  } catch (error) {
    console.error('[Scheduler] ❌ Error programando mensaje:', error.message);
    throw error;
  }
}

/**
 * Cancela mensajes pendientes de una cita
 */
async function cancelAppointmentMessages(appointmentId) {
  try {
    const result = await ScheduledMessage.update(
      { status: 'cancelled' },
      {
        where: {
          appointmentId,
          status: { [Op.in]: ['pending', 'failed'] }
        }
      }
    );
    return result[0];
  } catch (error) {
    console.error('[Scheduler] ❌ Error cancelando mensajes:', error.message);
    return 0;
  }
}

/**
 * Obtiene estadísticas de mensajes programados
 */
async function getStats(businessId = null) {
  const where = businessId ? { businessId } : {};
  return await ScheduledMessage.findAll({
    where,
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true
  });
}

/**
 * Limpia mensajes antiguos de BD
 */
async function cleanupOldMessages(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const scheduledDeleted = await ScheduledMessage.destroy({
      where: {
        status: { [Op.in]: ['sent', 'failed', 'cancelled'] },
        updatedAt: { [Op.lt]: cutoff }
      }
    });
    const incomingDeleted = await IncomingMessage.destroy({
      where: {
        status: { [Op.in]: ['processed', 'failed'] },
        updatedAt: { [Op.lt]: cutoff }
      }
    });
    return { scheduledDeleted, incomingDeleted };
  } catch (error) {
    console.error('[Scheduler Cleanup] ❌ Error limpiando mensajes:', error.message);
    return { scheduledDeleted: 0, incomingDeleted: 0, error: error.message };
  }
}

module.exports = {
  scheduleMessage,
  cancelAppointmentMessages,
  getStats,
  cleanupOldMessages
};
