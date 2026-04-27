/**
 * Servicio de alertas para citas pendientes no atendidas.
 * Revisa cada 1 minuto si hay citas con status 'pending' o 'confirmed' cuya hora de inicio ya pasó
 * y envía notificaciones push al empleado y admin para que actualicen el estado.
 * Alertas: 15min, 30min, 60min después de la hora de inicio.
 */

const { Appointment, Service, Employee, User, Business } = require('../models');
const { sendEmail } = require('../config/email');
const { sendPushNotification } = require('./pushNotificationService');
const { Op } = require('sequelize');

const CHECK_INTERVAL_MS = 1 * 60 * 1000;   // revisar cada 1 minuto para mayor precisión en el envío de alertas
const ALERT_15M_MS = 15 * 60 * 1000;
const ALERT_30M_MS = 30 * 60 * 1000;
const ALERT_60M_MS = 60 * 60 * 1000;

let intervalId = null;

async function sendPendingAlerts() {
  try {
    const now = Date.now();

    // ─── ALERTA 15 MINUTOS ───
    const cutoff15 = new Date(now - ALERT_15M_MS);
    const appts15 = await Appointment.findAll({
      where: {
        startTime: { [Op.lt]: cutoff15 },
        status: { [Op.in]: ['pending', 'confirmed'] },
        pendingAlertSent: false
      },
      include: includeOptions
    });
    for (const appt of appts15) await processStuckAlert(appt, '15 minutos', 'pendingAlertSent');

    // ─── ALERTA 30 MINUTOS ───
    const cutoff30 = new Date(now - ALERT_30M_MS);
    const appts30 = await Appointment.findAll({
      where: {
        startTime: { [Op.lt]: cutoff30 },
        status: { [Op.in]: ['pending', 'confirmed'] },
        pendingAlert30mSent: false
      },
      include: includeOptions
    });
    for (const appt of appts30) await processStuckAlert(appt, '30 minutos', 'pendingAlert30mSent');

    // ─── ALERTA 60 MINUTOS ───
    const cutoff60 = new Date(now - ALERT_60M_MS);
    const appts60 = await Appointment.findAll({
      where: {
        startTime: { [Op.lt]: cutoff60 },
        status: { [Op.in]: ['pending', 'confirmed'] },
        pendingAlert60mSent: false
      },
      include: includeOptions
    });
    for (const appt of appts60) await processStuckAlert(appt, '1 hora', 'pendingAlert60mSent');

  } catch (e) {
    console.error('[PendingAlert] ❌ Error en ciclo de alertas:', e.message);
  }
}

const includeOptions = [
  { model: Service, attributes: ['name'] },
  { model: Employee, include: [{ model: User, attributes: ['name', 'email', 'pushToken'] }] },
  { model: Business, include: [{ model: User, as: 'Owner', attributes: ['name', 'email', 'pushToken'] }] },
];

async function processStuckAlert(appt, timeLabel, fieldToUpdate) {
  try {
    const businessName = appt.Business?.name || 'Negocio';
    const serviceName = appt.Service?.name || 'Servicio';
    const employeeName = appt.Employee?.User?.name || 'Empleado';
    const clientName = appt.clientName || 'Cliente';

    // 1. Email solo en la primera alerta (15 min) para no saturar
    if (timeLabel === '15 minutos') {
      if (appt.Employee?.User?.email) {
        await sendEmail(appt.Employee.User.email, 'pendingAppointmentAlert', {
          recipientType: 'employee', employeeName, clientName, serviceName, businessName, startTime: String(appt.startTime), appointmentId: appt.id,
        });
      }
      if (appt.Business?.Owner?.email && appt.Business.Owner.email !== appt.Employee?.User?.email) {
        await sendEmail(appt.Business.Owner.email, 'pendingAppointmentAlert', {
          recipientType: 'admin', employeeName, clientName, serviceName, businessName, startTime: String(appt.startTime), appointmentId: appt.id,
        });
      }
    }

    // 2. Push al empleado - Mensajes más específicos según tiempo
    const employeePushToken = appt.Employee?.User?.pushToken;
    if (employeePushToken) {
      let title, body;
      
      if (timeLabel === '15 minutos') {
        title = '⏰ Han pasado 15 min';
        body = `La cita de ${clientName} (${serviceName}) empezó hace 15 min y no has cambiado el estado. ¡Actualízalo ahora!`;
      } else if (timeLabel === '30 minutos') {
        title = '🚨 ¡30 minutos! No has iniciado';
        body = `La cita de ${clientName} (${serviceName}) lleva 30 min sin iniciar atención. ¡Cambia el estado a "En atención" ahora!`;
      } else {
        title = '🔴 ¡URGENTE! 1 hora sin atención';
        body = `La cita de ${clientName} (${serviceName}) lleva 1 hora sin iniciar. ¡Actualiza el estado inmediatamente!`;
      }
      
      await sendPushNotification(employeePushToken, { title, body }, { 
        type: 'pending_alert', 
        appointmentId: appt.id,
        urgency: timeLabel === '15 minutos' ? 'low' : timeLabel === '30 minutos' ? 'medium' : 'high'
      });
    }

    // 3. Push al admin
    const adminPushToken = appt.Business?.Owner?.pushToken;
    if (adminPushToken && adminPushToken !== employeePushToken) {
      await sendPushNotification(adminPushToken, {
        title: timeLabel === '15 minutos' ? '⚠️ Cita retrasada' : timeLabel === '30 minutos' ? '🚨 Cita muy retrasada' : '🔴 Cita sin atención (1h)',
        body: `La cita de ${clientName} con ${employeeName} (${serviceName}) lleva ${timeLabel} sin iniciar atención.`,
      }, { 
        type: 'pending_alert', 
        appointmentId: appt.id,
        urgency: timeLabel === '15 minutos' ? 'low' : timeLabel === '30 minutos' ? 'medium' : 'high'
      });
    }

    await appt.update({ [fieldToUpdate]: true });
    console.log(`[PendingAlert] ✅ Alerta de ${timeLabel} enviada para cita ${appt.id}`);
  } catch (e) {
    console.error(`[PendingAlert] ❌ Error procesando alerta para cita ${appt.id}:`, e.message);
  }
}

function startPendingAlertService() {
  if (intervalId) return;
  console.log('[PendingAlert] 🔔 Servicio de alertas de citas pendientes iniciado (cada 1 min)');
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
