/**
 * Servicio de recordatorios automáticos de citas.
 * Cada minuto revisa si hay citas que empiecen en ~60 minutos
 * y envía un email de recordatorio al cliente si aún no se ha enviado.
 */

const { Appointment, Service, Employee, User, Business, ClientDevice } = require('../models');
const { sendEmail } = require('../config/email');
const { sendPushNotification } = require('./pushNotificationService');
const { Op } = require('sequelize');

const REMINDER_1H_MS  = 60 * 60 * 1000;  // 1 hora
const REMINDER_30M_MS = 30 * 60 * 1000;  // 30 minutos
const CHECK_INTERVAL_MS = 60 * 1000;     // cada minuto
const TOLERANCE_MS      = 60 * 1000;     // ±1 minuto

let intervalId = null;

async function sendReminders() {
  try {
    const now = Date.now();

    // ─── RECORDATORIOS DE 1 HORA ───
    const win1HStart = new Date(now + REMINDER_1H_MS - TOLERANCE_MS);
    const win1HEnd   = new Date(now + REMINDER_1H_MS + TOLERANCE_MS);

    const appts1H = await Appointment.findAll({
      where: {
        startTime: { [Op.between]: [win1HStart, win1HEnd] },
        status: { [Op.in]: ['pending', 'confirmed'] },
        reminderSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business },
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of appts1H) {
      await processReminder(appt, '1 hora', 'reminderSent');
    }

    // ─── RECORDATORIOS DE 30 MINUTOS ───
    const win30MStart = new Date(now + REMINDER_30M_MS - TOLERANCE_MS);
    const win30MEnd   = new Date(now + REMINDER_30M_MS + TOLERANCE_MS);

    const appts30M = await Appointment.findAll({
      where: {
        startTime: { [Op.between]: [win30MStart, win30MEnd] },
        status: { [Op.in]: ['pending', 'confirmed'] },
        reminder30mSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business },
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of appts30M) {
      await processReminder(appt, '30 minutos', 'reminder30mSent');
    }

  } catch (e) {
    console.error('[Reminder] ❌ Error en ciclo de recordatorios:', e.message);
  }
}

async function processReminder(appt, timeLabel, fieldToUpdate) {
  try {
    const businessName = appt.Business?.name || 'KDice';
    const serviceName = appt.Service?.name || 'Servicio';
    const employeeName = appt.Employee?.User?.name || 'Profesional';
    const startTimeStr = new Date(appt.startTime).toLocaleString('es-CO', { timeStyle: 'short' });

    // 1. Email al cliente (si es de 1h)
    if (timeLabel === '1 hora') {
      let clientEmail = appt.clientEmail;
      if (!clientEmail && appt.clientId) {
        const clientUser = await User.findByPk(appt.clientId);
        clientEmail = clientUser?.email;
      }
      if (clientEmail) {
        await sendEmail(clientEmail, 'appointmentReminder', {
          clientName: String(appt.clientName || ''),
          businessName: String(businessName),
          serviceName: String(serviceName),
          employeeName: String(employeeName),
          startTime: String(appt.startTime),
        });
      }
    }

    // 2. Push al cliente
    let clientPushToken = appt.Client?.pushToken;
    
    // Si no hay token del usuario registrado, buscar en dispositivos de clientes invitados (solo email)
    if (!clientPushToken && appt.clientEmail) {
      const guestDevice = await ClientDevice.findOne({ where: { email: appt.clientEmail.toLowerCase().trim() } });
      clientPushToken = guestDevice?.pushToken;
    }

    if (clientPushToken) {
      await sendPushNotification(clientPushToken, {
        title: `⏰ Recordatorio: ${timeLabel}`,
        body: `Tu cita para ${serviceName} en ${businessName} es a las ${startTimeStr}.`,
      }, { type: 'appointment_reminder', appointmentId: appt.id });
    }

    // 3. Push al empleado
    const employeePushToken = appt.Employee?.User?.pushToken;
    if (employeePushToken) {
      await sendPushNotification(employeePushToken, {
        title: `⏰ Recordatorio: ${timeLabel}`,
        body: `Cita con ${appt.clientName} (${serviceName}) a las ${startTimeStr}.`,
      }, { type: 'appointment_reminder', appointmentId: appt.id });
    }

    // Marcar como enviado
    await appt.update({ [fieldToUpdate]: true });
    console.log(`[Reminder] ✅ Recordatorio de ${timeLabel} enviado para cita ${appt.id}`);
  } catch (e) {
    console.error(`[Reminder] ❌ Error procesando cita ${appt.id}:`, e.message);
  }
}

function startReminderService() {
  if (intervalId) return; // ya está corriendo
  console.log('[Reminder] 🔔 Servicio de recordatorios iniciado (cada 1 minuto)');
  // Ejecutar inmediatamente al arrancar y luego cada minuto
  sendReminders();
  intervalId = setInterval(sendReminders, CHECK_INTERVAL_MS);
}

function stopReminderService() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Reminder] Servicio de recordatorios detenido');
  }
}

module.exports = { startReminderService, stopReminderService };
