/**
 * Motor principal del scheduler contextual
 */

const { Appointment, Business, Service, AppointmentReminderEvent } = require('../../../models');
const { Op } = require('sequelize');
const whatsappService = require('../../evolutionService');
const { releaseLock, createLockHeartbeat } = require('../distributedLock');
const { CONTEXTUAL_CONFIG, schedulerMetrics } = require('./config');
const { registerMessageSent, checkHumanActivityDelay, checkGlobalBackpressure } = require('./trackers');
const { getBusinessHourlyLimit } = require('./analysis');
const { calculateOptimalSendTime, getRelativeDayText } = require('./utils');
const { acquireLockWithRetry, claimEventAtomically } = require('./locking');

/**
 * Determina qué recordatorios necesita una cita
 */
function determineNeededReminders(appointment, backlogStatus = 'normal') {
  const now = new Date();
  const nowBogota = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' })).getTime();
  const appointmentTimeBogota = new Date(new Date(appointment.startTime).toLocaleString('en-US', { timeZone: 'America/Bogota' })).getTime();
  const timeUntilAppointment = appointmentTimeBogota - nowBogota;
  const gracePeriod = CONTEXTUAL_CONFIG.GRACE_PERIOD_MS;
  const timeSinceCreation = now - new Date(appointment.createdAt).getTime();

  if (appointment.status === 'cancelled') return [];

  // Esperar al menos 30 minutos después de agendar la cita para evitar enviar 
  // la confirmación inmediatamente después del mensaje de "cita agendada".
  if (timeSinceCreation < 30 * 60 * 1000) return [];

  const isConfirmed = appointment.confirmed === true;
  const needed = [];
  const dropped = [];

  // Recordatorio 24h
  const win24h = CONTEXTUAL_CONFIG.REMINDER_WINDOWS['24h'];
  const ttl24h = CONTEXTUAL_CONFIG.REMINDER_TTL['24h'];
  const canSend24h = !isConfirmed &&
    !appointment.reminder24hSent &&
    timeUntilAppointment <= (win24h.before + gracePeriod) &&
    timeUntilAppointment > (win24h.after - ttl24h);

  if (canSend24h) {
    if (backlogStatus === 'critical' && !isConfirmed) {
      dropped.push({ type: '24h', reason: 'load_shedding' });
    } else {
      needed.push({ type: '24h', timestampField: 'reminder24hSent', priority: 3 });
    }
  }

  // Recordatorio 12h
  const win12h = CONTEXTUAL_CONFIG.REMINDER_WINDOWS['12h'];
  const ttl12h = CONTEXTUAL_CONFIG.REMINDER_TTL['12h'];
  const canSend12h = !isConfirmed &&
    !appointment.reminder12hSent &&
    timeUntilAppointment <= (win12h.before + gracePeriod) &&
    timeUntilAppointment > (win12h.after - ttl12h);

  if (canSend12h) {
    if (backlogStatus === 'critical') {
      dropped.push({ type: '12h', reason: 'load_shedding' });
    } else {
      needed.push({ type: '12h', timestampField: 'reminder12hSent', priority: 3 });
    }
  }

  // Recordatorio 2h (Solo recordatorio)
  const win2h = CONTEXTUAL_CONFIG.REMINDER_WINDOWS['2h'];
  const ttl2h = CONTEXTUAL_CONFIG.REMINDER_TTL['2h'];
  const canSend2h = !appointment.reminder2hSent &&
    timeUntilAppointment <= (win2h.before + gracePeriod) &&
    timeUntilAppointment > (win2h.after - ttl2h);

  if (canSend2h) needed.push({ type: '2h', timestampField: 'reminder2hSent', priority: 2 });

  // Recordatorio 1h (Solo recordatorio, sin confirmación) - DESHABILITADO
  // const win1h = CONTEXTUAL_CONFIG.REMINDER_WINDOWS['1h'];
  // const ttl1h = CONTEXTUAL_CONFIG.REMINDER_TTL['1h'];
  // const canSend1h = !appointment.reminderSent &&
  //                   timeUntilAppointment <= (win1h.before + gracePeriod) &&
  //                   timeUntilAppointment > (win1h.after - ttl1h);

  // if (canSend1h) needed.push({ type: '1h', timestampField: 'reminderSent', priority: 1 });

  if (dropped.length > 0) {
    schedulerMetrics.droppedMessages += dropped.length;
    console.log(`[ContextualScheduler] 🗑️ Load shedding: ${dropped.length} recordatorios descartados`);
  }

  return needed;
}

/**
 * Envía un recordatorio contextual
 */
async function sendContextualReminder(businessId, appointment, reminderType, useReducedMessage = false) {
  if (!appointment || !appointment.Service || !appointment.Business) {
    throw new Error('Appointment lacks necessary relations (Service/Business)');
  }

  const { generateConfirmedReminder24h, generateUnconfirmedReminder24h,
    generateConfirmedReminder12h, generateUnconfirmedReminder12h,
    generateConfirmedReminder2h, generateUnconfirmedReminder2h,
    generateReminder1h } = require('../../reminder/message.generators');

  const timeStr = new Date(appointment.startTime).toLocaleTimeString('es-CO', {
    timeStyle: 'short', timeZone: 'America/Bogota'
  });

  let message;
  const isConfirmed = appointment.status === 'confirmed' || appointment.confirmed;

  if (useReducedMessage) {
    const clientName = appointment.clientName || 'Cliente';
    const serviceName = appointment.Service?.name || 'su cita';
    const businessName = appointment.Business?.name || 'nuestro negocio';
    message = `⏰ *${clientName}*, recordatorio urgente: tienes ${serviceName} en ${businessName} a las *${timeStr}*. ¡Nos vemos pronto!`;
  } else {
    switch (reminderType) {
      case '24h':
        message = isConfirmed ? generateConfirmedReminder24h(appointment, timeStr) : generateUnconfirmedReminder24h(appointment, timeStr);
        break;
      case '12h':
        const dayText = getRelativeDayText(appointment.startTime);
        message = isConfirmed ? generateConfirmedReminder12h(appointment, dayText) : generateUnconfirmedReminder12h(appointment, dayText);
        break;
      case '2h':
        message = isConfirmed ? generateConfirmedReminder2h(appointment, timeStr) : generateUnconfirmedReminder2h(appointment, timeStr);
        break;
      case '1h':
        message = generateReminder1h(appointment, timeStr, isConfirmed);
        break;
      default:
        throw new Error(`Tipo de recordatorio desconocido: ${reminderType}`);
    }
  }

  await whatsappService.sendMessageDirect(businessId, appointment.clientPhone, message);
}

/**
 * Ejecuta el scheduler contextual
 */
async function runContextualScheduler() {
  const runStartTime = Date.now();
  if (schedulerMetrics.lastRun) {
    schedulerMetrics.lagMs = runStartTime - schedulerMetrics.lastRun;
  }
  schedulerMetrics.lastRun = runStartTime;

  try {
    const businesses = await Business.findAll({ where: { status: 'active' } });
    let totalProcessed = 0;
    let totalSent = 0;
    let backlogCount = 0;
    const backlogStatus = schedulerMetrics.backlog > 50 ? 'critical' : 'normal';

    for (const business of businesses) {
      const limits = await getBusinessHourlyLimit(business.id);
      if (!limits.canSend) continue;
      if (!checkGlobalBackpressure()) {
        backlogCount += 10;
        continue;
      }

      const now = new Date();
      const lookaheadLimit = new Date(now.getTime() + 30 * 60 * 60 * 1000); // Buscar hasta 30 horas adelante

      const appointments = await Appointment.findAll({
        where: {
          businessId: business.id,
          startTime: { [Op.between]: [now, lookaheadLimit] },
          status: { [Op.in]: ['pending', 'confirmed', 'attention'] }
        },
        include: [{ model: Service }, { model: Business }],
        order: [['startTime', 'ASC']]
      });

      for (const appointment of appointments) {
        schedulerMetrics.lockContentionTotal++;
        const lockKey = `appointment:${appointment.id}:reminder`;
        const lockInfo = await acquireLockWithRetry(lockKey, 30000);

        if (!lockInfo.acquired) {
          schedulerMetrics.lockContentionCount++;
          continue;
        }

        const heartbeat = createLockHeartbeat(lockKey, lockInfo.token, 10000, 30000);

        try {
          const freshAppointment = await Appointment.findByPk(appointment.id, {
            include: [{ model: Service }, { model: Business }]
          });
          if (!freshAppointment) continue;

          const neededReminders = determineNeededReminders(freshAppointment, backlogStatus);
          if (neededReminders.length === 0) continue;

          neededReminders.sort((a, b) => a.priority - b.priority);

          for (const reminder of neededReminders) {
            const currentLimits = await getBusinessHourlyLimit(business.id);
            if (!currentLimits.canSend) break;

            const humanDelay = checkHumanActivityDelay(business.id);
            if (humanDelay > 0) continue;

            const delay = calculateOptimalSendTime(freshAppointment, reminder.type);
            const isCritical = reminder.priority <= 2;
            if (isCritical && delay > CONTEXTUAL_CONFIG.CRITICAL_REMINDER_MAX_DELAY_MS && !CONTEXTUAL_CONFIG.ENABLE_REDUCED_CRITICAL_MESSAGES) continue;

            if (delay !== null && delay <= 60 * 1000) {
              const moreCriticalSent = await AppointmentReminderEvent.findOne({
                where: {
                  appointmentId: freshAppointment.id,
                  status: 'sent',
                  reminderType: { [Op.in]: ['1h', '2h'] }
                }
              });
              if (moreCriticalSent && ['12h', '24h'].includes(reminder.type)) continue;

              const twoMinutesAgo = new Date(Date.now() - CONTEXTUAL_CONFIG.PROCESSING_TIMEOUT_MS);
              const workerId = `${process.pid}-${Date.now()}`;
              const claimedEvent = await claimEventAtomically(freshAppointment.id, reminder.type, workerId, twoMinutesAgo);

              let eventId;
              if (claimedEvent) {
                if (claimedEvent.retryCount >= CONTEXTUAL_CONFIG.MAX_RETRIES) continue;
                const baseBackoff = CONTEXTUAL_CONFIG.RETRY_BACKOFF_MS[claimedEvent.retryCount] || 600000;
                const jitter = 0.8 + Math.random() * 0.4;
                const backoffMs = Math.round(baseBackoff * jitter);
                const lastAttempt = claimedEvent.updatedAt || claimedEvent.createdAt;
                let timeSinceLastAttempt = Date.now() - new Date(lastAttempt).getTime();
                if (timeSinceLastAttempt < 0) timeSinceLastAttempt = 0;

                if (timeSinceLastAttempt < backoffMs) {
                  await AppointmentReminderEvent.update({ processingBy: null, processingAt: null }, { where: { id: claimedEvent.id } });
                  continue;
                }
                eventId = claimedEvent.id;
                schedulerMetrics.retryCount++;
              } else {
                try {
                  const newEvent = await AppointmentReminderEvent.create({
                    appointmentId: freshAppointment.id,
                    businessId: business.id,
                    reminderType: reminder.type,
                    status: 'pending',
                    clientPhone: freshAppointment.clientPhone,
                    processId: workerId,
                    processingBy: workerId,
                    processingAt: new Date()
                  });
                  eventId = newEvent.id;
                } catch (error) {
                  if (error.name === 'SequelizeUniqueConstraintError' || (error.original && error.original.code === '23505')) {
                    schedulerMetrics.duplicateAvoided++;
                    schedulerMetrics.dbUniqueViolations++;
                    continue;
                  }
                  throw error;
                }
              }

              const sendStartTime = Date.now();
              try {
                await sendContextualReminder(business.id, freshAppointment, reminder.type, isCritical && delay > CONTEXTUAL_CONFIG.CRITICAL_REMINDER_MAX_DELAY_MS);
                const sendLatency = Date.now() - sendStartTime;
                await AppointmentReminderEvent.update({ status: 'sent', sentAt: new Date(), processingBy: null, processingAt: null }, { where: { id: eventId } });
                const updateData = { [reminder.timestampField]: true };
                if (!freshAppointment.confirmed && ['24h', '12h', '2h'].includes(reminder.type)) {
                  updateData.messageFlowStatus = 'awaiting_confirmation';
                }
                await freshAppointment.update(updateData);
                registerMessageSent(business.id);
                totalSent++;
                schedulerMetrics.onTimeDelivery++;
                schedulerMetrics.totalSendLatencyMs += sendLatency;
                schedulerMetrics.sendCount++;
                schedulerMetrics.retrySuccess++;
                schedulerMetrics.recentLatencies.push(sendLatency);
                if (schedulerMetrics.recentLatencies.length > 1000) schedulerMetrics.recentLatencies.shift();
                break;
              } catch (sendError) {
                const sendLatency = Date.now() - sendStartTime;
                await AppointmentReminderEvent.update({ status: 'failed', lastError: sendError.message.substring(0, 500), processingBy: null, processingAt: null }, { where: { id: eventId } });
                schedulerMetrics.sendFailures++;
                schedulerMetrics.totalSendLatencyMs += sendLatency;
                schedulerMetrics.sendCount++;
              }
            }
          }
        } finally {
          heartbeat.stop();
          await releaseLock(lockKey, lockInfo.token);
        }
        totalProcessed++;
      }
    }
    schedulerMetrics.backlog = backlogCount;
    schedulerMetrics.totalProcessed += totalProcessed;
    return { processed: totalProcessed, sent: totalSent, backlog: backlogCount };
  } catch (error) {
    console.error('[ContextualScheduler] ❌ Error:', error.message);
    return { error: error.message };
  }
}

module.exports = {
  runContextualScheduler
};
