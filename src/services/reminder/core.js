/**
 * Núcleo del servicio de recordatorios - Ciclo principal
 */
const {
  REMINDER_CONFIG,
  findAppointmentsForReminder,
  findAppointmentsForFutureReminder,
  findAppointmentsForReference,
} = require('./queries');
const { formatTime } = require('./time.utils');
const { generateReminder1h } = require('./message.generators');
const { scheduleWhatsAppMessage, sendEmployeePush } = require('./notifications');
const {
  processStandardReminder,
  processGenericReminder,
  processReferenceMessage,
  processTechnicianReminder,
} = require('./processors');

let intervalId = null;
const processingAppts = new Set();

async function sendReminders() {
  try {
    const now = Date.now();
    processingAppts.clear();

    // 24h, 12h, 2h (con ventanas simétricas)
    for (const [key, config] of Object.entries(REMINDER_CONFIG).filter(([k]) => ['24h', '12h', '2h'].includes(k))) {
      const appts = await findAppointmentsForReminder({ now, reminderMs: config.ms, field: config.field, windowMinutes: config.windowMinutes });
      for (const appt of appts) {
        if (processingAppts.has(appt.id)) continue;
        processingAppts.add(appt.id);
        await processStandardReminder(appt, config, key.replace('h', ' horas'));
      }
    }

    // 1h, 30m, 15m (futuro solo)
    for (const [key, config] of Object.entries(REMINDER_CONFIG).filter(([k]) => ['1h', '30m', '15m'].includes(k))) {
      const appts = await findAppointmentsForFutureReminder({ now, reminderMs: config.ms, field: config.field, windowMinutes: config.windowMinutes });
      for (const appt of appts) {
        if (processingAppts.has(appt.id)) continue;
        processingAppts.add(appt.id);

        const timeLabel = key === '1h' ? '1 hora' : key === '30m' ? '30 minutos' : '15 minutos';

        // Enviar notificación push al empleado asignado para 15m, 30m y 1h
        if (key === '1h') {
          await sendEmployeePush(appt, '⏰ Cita en 1 hora',
            `Tienes una cita con ${appt.clientName || 'Cliente'} (${appt.Service?.name || 'Servicio'}) en 1 hora.`);
        } else if (key === '30m') {
          await sendEmployeePush(appt, '⏰ Cita en 30 minutos',
            `Tienes una cita con ${appt.clientName || 'Cliente'} (${appt.Service?.name || 'Servicio'}) en 30 minutos.`);
        } else if (key === '15m') {
          await sendEmployeePush(appt, '⏰ Cita en 15 minutos',
            `Tienes una cita con ${appt.clientName || 'Cliente'} (${appt.Service?.name || 'Servicio'}) en 15 minutos.`);
        }

        if (appt.clientPhone && !appt.Business?.hasFieldTechnicians) {
          const timeStr = formatTime(appt.startTime);
          const isConfirmed = appt.confirmed === true || appt.status === 'confirmed';
          const message = generateReminder1h(appt, timeStr, isConfirmed);
          await scheduleWhatsAppMessage(appt, message, 'reminder');
          await appt.update({ [config.field]: true });
          console.log(`[Reminder${key}] 📅 Recordatorio programado para cita ${appt.id}`);
        } else {
          await processGenericReminder(appt, timeLabel, config.field);
        }
      }
    }

    // Mensaje de referencia (hora exacta)
    const refAppts = await findAppointmentsForReference(now);
    for (const appt of refAppts) {
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processReferenceMessage(appt);
      }
    }

    // Técnicos de campo: 60m, 30m, 15m
    for (const [key, config] of Object.entries(REMINDER_CONFIG).filter(([k]) => k.startsWith('tech'))) {
      const appts = await findAppointmentsForReminder({
        now, reminderMs: config.ms, field: config.field, windowMinutes: config.windowMinutes,
        requireFieldTechnicians: true
      });
      const timeLabel = key === 'tech60m' ? '60 minutos' : key === 'tech30m' ? '30 minutos' : '15 minutos';
      const alertEmoji = key === 'tech60m' ? '🚨 ¡En 1 hora!' : key === 'tech30m' ? '⏰ ¡En 30 minutos!' : '🔥 ¡Ya casi! 15 min';

      for (const appt of appts) {
        if (!processingAppts.has(appt.id)) {
          processingAppts.add(appt.id);
          await processTechnicianReminder(appt, timeLabel, config.field, alertEmoji);
        }
      }
    }

  } catch (e) {
    console.error('[Reminder] ❌ Error en ciclo de recordatorios:', e.message);
  }
}

function startReminderService() {
  if (intervalId) return;
  console.log('[Reminder] 🔔 Servicio de recordatorios iniciado (cada 1 minuto)');
  sendReminders();
  intervalId = setInterval(sendReminders, 60 * 1000);
}

function stopReminderService() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Reminder] Servicio de recordatorios detenido');
  }
}

module.exports = {
  startReminderService,
  stopReminderService,
};
