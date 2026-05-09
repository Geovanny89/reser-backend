/**
 * Gestión de locks y claims atómicos
 */

const { AppointmentReminderEvent, sequelize } = require('../../../models');
const { Op } = require('sequelize');
const { acquireLock } = require('../distributedLock');

/**
 * Adquiere un lock con reintentos
 */
async function acquireLockWithRetry(key, ttlMs) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const lockInfo = await acquireLock(key, ttlMs);
    if (lockInfo.acquired) {
      return lockInfo;
    }
    if (attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return { acquired: false, token: null };
}

/**
 * Claim atómico de evento zombie o failed
 */
async function claimEventAtomically(appointmentId, reminderType, workerId, timeoutThreshold) {
  try {
    const [affectedRows] = await AppointmentReminderEvent.update(
      {
        processingBy: workerId,
        processingAt: new Date(),
        retryCount: sequelize.literal('"retryCount" + 1'),
        processId: workerId,
        status: 'pending',
        lastError: null
      },
      {
        where: {
          appointmentId: appointmentId,
          reminderType: reminderType,
          [Op.or]: [
            { status: 'failed' },
            {
              status: 'pending',
              [Op.or]: [
                { processingAt: null },
                { processingAt: { [Op.lt]: timeoutThreshold } }
              ]
            }
          ],
          [Op.or]: [
            { processingBy: null },
            { processingAt: { [Op.lt]: timeoutThreshold } }
          ]
        },
        returning: true,
        plain: false
      }
    );

    if (affectedRows === 0) return null;

    return await AppointmentReminderEvent.findOne({
      where: {
        appointmentId: appointmentId,
        reminderType: reminderType,
        processingBy: workerId
      }
    });
  } catch (error) {
    console.error('[ContextualScheduler] ❌ Error en claim atómico:', error.message);
    return null;
  }
}

module.exports = {
  acquireLockWithRetry,
  claimEventAtomically
};
