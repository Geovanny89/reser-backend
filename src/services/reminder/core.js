/**
 * Núcleo del servicio de recordatorios - Ciclo principal
 */
const {
  REMINDER_CONFIG,
  CHECK_INTERVAL_MS,
} = require('./config');
const {
  findAppointmentsForReminder,
  findAppointmentsForReference,
} = require('./queries');
const {
  processStandardReminder,
  processGenericReminder,
  processReferenceMessage,
  processTechnicianReminder,
} = require('./processors');
const { sendEmployeePush } = require('./notifications');

let intervalId = null;
const processingAppts = new Set();

/**
 * Función principal del ciclo de recordatorios
 */
async function sendReminders() {
  try {
    const now = Date.now();
    processingAppts.clear();

    // 1. Recordatorios Estándar (24h, 12h, 2h) - Ventana de +/- 10 min
    const standardKeys = ['24h', '12h', '2h'];
    for (const key of standardKeys) {
      const config = REMINDER_CONFIG[key];
      const appts = await findAppointmentsForReminder({ 
        now, 
        reminderMs: config.ms, 
        field: config.field, 
        windowMinutes: config.windowMinutes 
      });
      
      for (const appt of appts) {
        if (processingAppts.has(appt.id)) continue;
        processingAppts.add(appt.id);
        await processStandardReminder(appt, config, key.replace('h', ' horas'));
      }
    }

    // 2. Recordatorios de 1 Hora (1h)
    const config1h = REMINDER_CONFIG['1h'];
    const appts1h = await findAppointmentsForReminder({ 
      now, 
      reminderMs: config1h.ms, 
      field: config1h.field, 
      windowMinutes: config1h.windowMinutes 
    });
    
    for (const appt of appts1h) {
      if (processingAppts.has(appt.id)) continue;
      processingAppts.add(appt.id);
      
      // Push al empleado
      await sendEmployeePush(appt, '⏰ Cita en 1 hora',
        `Tienes una cita con ${appt.clientName || 'Cliente'} (${appt.Service?.name || 'Servicio'}) en 1 hora.`);
        
      await processGenericReminder(appt, '1 hora', config1h.field);
    }

    // 3. Recordatorios de 30 Minutos (30m)
    const config30m = REMINDER_CONFIG['30m'];
    const appts30m = await findAppointmentsForReminder({ 
      now, 
      reminderMs: config30m.ms, 
      field: config30m.field, 
      windowMinutes: config30m.windowMinutes 
    });
    
    for (const appt of appts30m) {
      if (processingAppts.has(appt.id)) continue;
      processingAppts.add(appt.id);
      
      // Push al empleado
      await sendEmployeePush(appt, '⏰ Cita en 30 minutos',
        `Tienes una cita con ${appt.clientName || 'Cliente'} (${appt.Service?.name || 'Servicio'}) en 30 minutos.`);
        
      await processGenericReminder(appt, '30 minutos', config30m.field);
    }

    // 4. Mensaje de Referencia (Hora exacta)
    const refAppts = await findAppointmentsForReference(now);
    for (const appt of refAppts) {
      if (processingAppts.has(appt.id)) continue;
      processingAppts.add(appt.id);
      await processReferenceMessage(appt);
    }

    // 5. Notificaciones para Técnicos de Campo (60m, 30m, 15m)
    const techKeys = ['tech60m', 'tech30m', 'tech15m'];
    for (const key of techKeys) {
      const config = REMINDER_CONFIG[key];
      const appts = await findAppointmentsForReminder({
        now, 
        reminderMs: config.ms, 
        field: config.field, 
        windowMinutes: config.windowMinutes,
        requireFieldTechnicians: true
      });
      
      const labels = {
        'tech60m': { label: '60 minutos', emoji: '🚨 ¡En 1 hora!' },
        'tech30m': { label: '30 minutos', emoji: '⏰ ¡En 30 minutos!' },
        'tech15m': { label: '15 minutos', emoji: '🔥 ¡Ya casi! 15 min' }
      };

      for (const appt of appts) {
        if (processingAppts.has(appt.id)) continue;
        processingAppts.add(appt.id);
        await processTechnicianReminder(appt, labels[key].label, config.field, labels[key].emoji);
      }
    }

  } catch (e) {
    console.error('[Reminder] ❌ Error en ciclo de recordatorios:', e.message);
  }
}

/**
 * Inicia el servicio de recordatorios
 */
function startReminderService() {
  if (intervalId) return;
  console.log('[Reminder] 🔔 Servicio de recordatorios iniciado (cada 1 minuto)');
  sendReminders();
  intervalId = setInterval(sendReminders, CHECK_INTERVAL_MS);
}

/**
 * Detiene el servicio de recordatorios
 */
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
