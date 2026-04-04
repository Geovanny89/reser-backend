/**
 * Servicio de alertas para citas pendientes no atendidas.
 * Revisa cada 30 minutos si hay citas con status 'scheduled' cuya hora de inicio ya pasó
 * y envía notificaciones al admin y empleado para que actualicen el estado.
 */

const { Appointment, Service, Employee, User, Business } = require('../models');
const { sendEmail } = require('../config/email');
const { Op } = require('sequelize');

const CHECK_INTERVAL_MS = 30 * 60 * 1000;  // revisar cada 30 minutos
const GRACE_PERIOD_MS   = 15 * 60 * 1000;  // tolerancia: 15 minutos después de la hora

let intervalId = null;

async function sendPendingAlerts() {
  try {
    const now = Date.now();
    // Buscar citas que:
    // - Están en status 'scheduled' (no atendidas/canceladas/completadas)
    // - La hora de inicio ya pasó (más el período de gracia)
    // - No se ha enviado alerta aún (pendingAlertSent = false o null)
    const cutoffTime = new Date(now - GRACE_PERIOD_MS);

    const appointments = await Appointment.findAll({
      where: {
        startTime: { [Op.lt]: cutoffTime },
        status: 'confirmed',
        [Op.or]: [
          { pendingAlertSent: false },
          { pendingAlertSent: null }
        ]
      },
      include: [
        { model: Service, attributes: ['name', 'durationMin'] },
        { 
          model: Employee, 
          include: [{ model: User, attributes: ['name', 'email', 'pushToken'] }] 
        },
        { model: Business, include: [{ model: User, as: 'Owner', attributes: ['email', 'pushToken'] }] },
      ],
    });

    console.log(`[PendingAlert] 🔍 Encontradas ${appointments.length} citas pendientes no atendidas`);

    for (const appt of appointments) {
      try {
        const businessName = appt.Business?.name || 'Tu negocio';
        const serviceName = appt.Service?.name || 'Servicio';
        const employeeName = appt.Employee?.User?.name || 'Empleado';
        const employeeEmail = appt.Employee?.User?.email;
        const adminEmail = appt.Business?.Owner?.email;
        const clientName = appt.clientName || 'Cliente';

        // Enviar email al empleado asignado
        if (employeeEmail) {
          await sendEmail(employeeEmail, 'pendingAppointmentAlert', {
            recipientType: 'employee',
            employeeName: String(employeeName),
            clientName: String(clientName),
            serviceName: String(serviceName),
            businessName: String(businessName),
            startTime: String(appt.startTime),
            appointmentId: String(appt.id),
          });
          console.log(`[PendingAlert] 📧 Email enviado a empleado ${employeeEmail} para cita ${appt.id}`);
        }

        // Enviar email al admin
        if (adminEmail && adminEmail !== employeeEmail) {
          await sendEmail(adminEmail, 'pendingAppointmentAlert', {
            recipientType: 'admin',
            employeeName: String(employeeName),
            clientName: String(clientName),
            serviceName: String(serviceName),
            businessName: String(businessName),
            startTime: String(appt.startTime),
            appointmentId: String(appt.id),
          });
          console.log(`[PendingAlert] 📧 Email enviado a admin ${adminEmail} para cita ${appt.id}`);
        }

        // Aquí iría la lógica de notificación push (Firebase/OneSignal)
        // await sendPushNotification(...);

        // Marcar como alerta enviada
        await appt.update({ pendingAlertSent: true });
        
      } catch (e) {
        console.error(`[PendingAlert] ❌ Error procesando cita ${appt.id}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[PendingAlert] ❌ Error en ciclo de alertas:', e.message);
  }
}

function startPendingAlertService() {
  if (intervalId) return;
  console.log('[PendingAlert] 🔔 Servicio de alertas de citas pendientes iniciado (cada 30 min)');
  sendPendingAlerts(); // ejecutar inmediatamente
  intervalId = setInterval(sendPendingAlerts, CHECK_INTERVAL_MS);
}

function stopPendingAlertService() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[PendingAlert] Servicio de alertas detenido');
  }
}

module.exports = { startPendingAlertService, stopPendingAlertService };
