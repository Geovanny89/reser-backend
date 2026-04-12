/**
 * Servicio de recordatorios automáticos de citas.
 * Cada minuto revisa si hay citas que empiecen en ~60 minutos
 * y envía un email de recordatorio al cliente si aún no se ha enviado.
 */

const { Appointment, Service, Employee, User, Business, ClientDevice, WhatsAppSession } = require('../models');
const { sendEmail } = require('../config/email');
const { sendPushNotification } = require('./pushNotificationService');
const { queueMessage, getRandomReminderTemplate } = require('./whatsappService');
const { Op } = require('sequelize');

const REMINDER_24H_MS = 24 * 60 * 60 * 1000; // 24 horas
const REMINDER_2H_MS  = 2 * 60 * 60 * 1000;  // 2 horas
const REMINDER_1H_MS  = 60 * 60 * 1000;  // 1 hora
const REMINDER_30M_MS = 30 * 60 * 1000;  // 30 minutos
const CHECK_INTERVAL_MS = 60 * 1000;     // cada minuto
const TOLERANCE_MS      = 60 * 1000;     // ±1 minuto

let intervalId = null;

const processingAppts = new Set(); // Prevenir duplicados en la misma ejecución

async function sendReminders() {
  try {
    const now = Date.now();
    processingAppts.clear(); // Limpiar al inicio de cada ciclo

    // ─── RECORDATORIOS DE 24 HORAS ───
    // Buscamos cualquier cita pendiente que empiece en las próximas 24 horas y no haya enviado el aviso.
    // Usamos una ventana de tiempo más amplia para no perder avisos si el servidor se reinicia.
    const win24HStart = new Date(now + REMINDER_24H_MS - (10 * 60 * 1000)); // -10 min de margen
    const win24HEnd = new Date(now + REMINDER_24H_MS + (10 * 60 * 1000)); // +10 min de gracia

    const appts24H = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: win24HEnd, [Op.gte]: win24HStart },
        status: { [Op.in]: ['pending', 'confirmed'] },
        reminder24hSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business },
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of appts24H) {
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processReminder24h(appt);
      }
    }

    // ─── RECORDATORIOS DE 2 HORAS ───
    const win2HStart = new Date(now + REMINDER_2H_MS - (10 * 60 * 1000));
    const win2HEnd = new Date(now + REMINDER_2H_MS + (10 * 60 * 1000));

    const appts2H = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: win2HEnd, [Op.gte]: win2HStart },
        status: { [Op.in]: ['pending', 'confirmed'] },
        reminder2hSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business },
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of appts2H) {
      if (processingAppts.has(appt.id)) continue;
      processingAppts.add(appt.id);
      
      await processReminder(appt, '2 horas', 'reminder2hSent');
      
      // Enviar también por WhatsApp si el negocio tiene sesión activa
      if (appt.clientPhone) {
        const resolvedBizId = await Business.resolveWhatsAppBusinessId(appt.businessId);
        const session = await WhatsAppSession.findOne({ 
          where: { businessId: resolvedBizId, status: 'connected' } 
        });
        if (session) {
          const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short' });
          const isConfirmed = appt.confirmed === true || appt.status === 'confirmed';
          
          if (isConfirmed) {
            // Si ya está confirmada, solo recordatorio simple
            const text = `👋 Hola *${appt.clientName}*, te recordamos tu cita confirmada para *${appt.Service?.name || 'Servicio'}* hoy a las *${timeStr}* en *${appt.Business?.name || 'Negocio'}*.\n\n¡Te esperamos! ✅`;
            await queueMessage(appt.businessId, appt.clientPhone, text);
          } else {
            // Si NO está confirmada, pedir confirmación
            const template = getRandomReminderTemplate();
            const intro = template.intro
              .replace('{name}', appt.clientName)
              .replace('{service}', appt.Service?.name || 'Servicio')
              .replace('{business}', appt.Business?.name || 'Negocio')
              .replace('{time}', timeStr);
            const text = `${intro}\n\n${template.question}\nResponde *1* para CONFIRMAR ✅\nResponde *2* para CANCELAR ❌`;
            await queueMessage(appt.businessId, appt.clientPhone, text);
          }
        }
      }
    }

    // ─── RECORDATORIOS DE 1 HORA ───
    const win1HEnd = new Date(now + REMINDER_1H_MS + (5 * 60 * 1000));

    const appts1H = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: win1HEnd, [Op.gt]: new Date(now) },
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
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processReminder(appt, '1 hora', 'reminderSent');
      }
    }

    // ─── RECORDATORIOS DE 30 MINUTOS ───
    const win30MEnd = new Date(now + REMINDER_30M_MS + (5 * 60 * 1000));

    const appts30M = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: win30MEnd, [Op.gt]: new Date(now) },
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
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processReminder(appt, '30 minutos', 'reminder30mSent');
      }
    }

  } catch (e) {
    console.error('[Reminder] ❌ Error en ciclo de recordatorios:', e.message);
  }
}

async function processReminder24h(appt) {
  try {
    const businessName = appt.Business?.name || 'KDice';
    const serviceName = appt.Service?.name || 'Servicio';
    const employeeName = appt.Employee?.User?.name || 'Profesional';
    const startTimeStr = new Date(appt.startTime).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' });
    
    // Build confirmation and cancellation URLs
    const API_URL = process.env.API_URL || 'https://api-reservas.k-dice.com';
    const confirmUrl = `${API_URL}/api/appointments/${appt.id}/confirm`;
    const cancelUrl  = `${API_URL}/api/appointments/${appt.id}/cancel-from-email`;

    // 1. Push al cliente
    let clientPushToken = appt.Client?.pushToken;
    if (!clientPushToken && appt.clientEmail) {
      const guestDevice = await ClientDevice.findOne({ where: { email: appt.clientEmail.toLowerCase().trim() } });
      clientPushToken = guestDevice?.pushToken;
    }

    if (clientPushToken) {
      await sendPushNotification(clientPushToken, {
        title: `📅 Recordatorio: Cita mañana`,
        body: `Tienes una cita para ${serviceName} en ${businessName} mañana a las ${new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short' })}. Confirma tu asistencia.`,
      }, { type: 'appointment_reminder_24h', appointmentId: appt.id, confirmUrl });
    }

    // 3. WhatsApp al cliente (Recordatorio 24h SIMPLE - sin confirmación)
    if (appt.clientPhone) {
      const resolvedBizId = await Business.resolveWhatsAppBusinessId(appt.businessId);
      const session = await WhatsAppSession.findOne({ 
        where: { businessId: resolvedBizId, status: 'connected' } 
      });
      if (session) {
        const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short' });
        const text = `👋 Hola *${appt.clientName}*, te recordamos que tienes una cita para *${serviceName}* mañana a las *${timeStr}* en *${businessName}*.\n\n¡Te esperamos! 🗓️`;
        await queueMessage(appt.businessId, appt.clientPhone, text);
      }
    }

    // Marcar como enviado
    await appt.update({ reminder24hSent: true });
    console.log(`[Reminder24h] ✅ Recordatorio 24h enviado para cita ${appt.id}`);
  } catch (e) {
    console.error(`[Reminder24h] ❌ Error procesando cita ${appt.id}:`, e.message);
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
