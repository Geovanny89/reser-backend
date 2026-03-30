/**
 * Servicio de recordatorios automáticos de citas.
 * Cada minuto revisa si hay citas que empiecen en ~60 minutos
 * y envía un email de recordatorio al cliente si aún no se ha enviado.
 */

const { Appointment, Service, Employee, User, Business } = require('../models');
const { sendEmail } = require('../config/email');
const { Op } = require('sequelize');

const REMINDER_WINDOW_MS = 60 * 60 * 1000; // 1 hora en ms
const CHECK_INTERVAL_MS  = 60 * 1000;       // revisar cada 1 minuto
const TOLERANCE_MS       = 60 * 1000;       // tolerancia de ±1 minuto

let intervalId = null;

async function sendReminders() {
  try {
    const now = Date.now();
    // Ventana: citas que empiezan entre ahora+59min y ahora+61min
    const windowStart = new Date(now + REMINDER_WINDOW_MS - TOLERANCE_MS);
    const windowEnd   = new Date(now + REMINDER_WINDOW_MS + TOLERANCE_MS);

    const appointments = await Appointment.findAll({
      where: {
        startTime: { [Op.between]: [windowStart, windowEnd] },
        status: { [Op.in]: ['pending', 'confirmed'] },
        reminderSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: Business },
      ],
    });

    for (const appt of appointments) {
      try {
        // Determinar email del cliente: usuario registrado o email directo
        let clientEmailTo = null;

        if (appt.clientId) {
          const clientUser = await User.findByPk(appt.clientId);
          clientEmailTo = clientUser?.email || null;
        }
        if (!clientEmailTo && appt.clientEmail) {
          clientEmailTo = appt.clientEmail;
        }

        if (clientEmailTo) {
          await sendEmail(clientEmailTo, 'appointmentReminder', {
            clientName:   appt.clientName,
            businessName: appt.Business?.name,
            serviceName:  appt.Service?.name,
            employeeName: appt.Employee?.User?.name,
            startTime:    appt.startTime,
          });
          console.log(`[Reminder] ✅ Recordatorio enviado a ${clientEmailTo} para cita ${appt.id}`);
        }

        // Marcar como enviado aunque no haya email (para no reintentar)
        await appt.update({ reminderSent: true });
      } catch (e) {
        console.error(`[Reminder] ❌ Error procesando cita ${appt.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[Reminder] ❌ Error en ciclo de recordatorios:', e.message);
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
