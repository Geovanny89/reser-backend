/**
 * Servicio de recordatorios automáticos de citas.
 * Cada minuto revisa citas y programa mensajes de WhatsApp usando schedulerService
 * para persistencia y envío confiable incluso cuando WhatsApp está desconectado.
 */

const { Appointment, Service, Employee, User, Business, ClientDevice } = require('../models');
const { sendEmail } = require('../config/email');
const { sendPushNotification } = require('./pushNotificationService');
const { getRandomReminderTemplate } = require('./whatsappService');
const { scheduleMessage, isBusinessHours } = require('./schedulerService');
const { Op } = require('sequelize');

const REMINDER_24H_MS = 24 * 60 * 60 * 1000; // 24 horas
const REMINDER_12H_MS = 12 * 60 * 60 * 1000; // 12 horas
const REMINDER_2H_MS  = 2 * 60 * 60 * 1000;  // 2 horas
const REMINDER_1H_MS  = 60 * 60 * 1000;      // 1 hora
const REMINDER_60M_MS = 60 * 60 * 1000;      // 60 minutos (técnicos)
const REMINDER_30M_MS = 30 * 60 * 1000;      // 30 minutos
const REMINDER_15M_MS = 15 * 60 * 1000;      // 15 minutos (técnicos)
const CHECK_INTERVAL_MS = 60 * 1000;         // cada minuto
const TOLERANCE_MS      = 60 * 1000;         // ±1 minuto

// Opciones de zona horaria Colombia para toLocaleString
const COLOMBIA_TIME_OPTIONS = { timeZone: 'America/Bogota' };

/**
 * Determina si una fecha es hoy, mañana o en el futuro
 * Compara las fechas en zona horaria Colombia
 */
function getRelativeDayText(date, timeStr) {
  const now = new Date();
  const colombiaNow = new Date(now.toLocaleString('en-US', COLOMBIA_TIME_OPTIONS));
  const colombiaDate = new Date(date.toLocaleString('en-US', COLOMBIA_TIME_OPTIONS));
  
  // Resetear horas para comparar solo fechas
  const today = new Date(colombiaNow.getFullYear(), colombiaNow.getMonth(), colombiaNow.getDate());
  const appointmentDay = new Date(colombiaDate.getFullYear(), colombiaDate.getMonth(), colombiaDate.getDate());
  
  const diffMs = appointmentDay - today;
  const diffDays = diffMs / (24 * 60 * 60 * 1000);
  
  if (diffDays === 0) return `hoy a las *${timeStr}*`;
  if (diffDays === 1) return `mañana a las *${timeStr}*`;
  return `el ${appointmentDay.toLocaleDateString('es-CO')} a las *${timeStr}*`;
}

/**
 * Verifica si la hora actual en Colombia está dentro del horario permitido para enviar mensajes
 * (7:00 AM - 8:00 PM Colombia)
 */
function isWithinBusinessHours() {
  return isBusinessHours();
}

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

    // ─── RECORDATORIOS DE 12 HORAS ───
    // Enviar recordatorio 12 horas antes de la cita, dentro del horario 7am-8pm
    const win12HStart = new Date(now + REMINDER_12H_MS - (10 * 60 * 1000));
    const win12HEnd = new Date(now + REMINDER_12H_MS + (10 * 60 * 1000));

    const appts12H = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: win12HEnd, [Op.gte]: win12HStart },
        status: { [Op.in]: ['pending', 'confirmed'] },
        reminder12hSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business },
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of appts12H) {
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processReminder12h(appt);
      }
    }

    // ─── RECORDATORIOS DE 2 HORAS ───
    // Enviar mensaje de confirmación/cancelación si no ha confirmado
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

      // 2h: Recordatorio amable si confirmó, o pedir confirmación si no
      if (appt.clientPhone && !appt.Business?.hasFieldTechnicians) {
        const isConfirmed = appt.confirmed === true || appt.status === 'confirmed';
        const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short', timeZone: 'America/Bogota' });
        
        let text;
        let msgType = 'reminder';
        
        if (isConfirmed) {
          // Cita YA confirmada: recordatorio amable
          const templates = [
            `⏰ *${appt.clientName}*, te esperamos en 2 horas (${timeStr}) para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. ¡Todo listo! 🗓️`,
            `🎯 *${appt.clientName}*, recordatorio: tu cita confirmada es en *2 horas* (${timeStr}) en *${appt.Business?.name || 'Negocio'}*. ¡Nos vemos pronto! 😊`,
            `✅ *${appt.clientName}*, nos vemos en 2 horas (${timeStr}) para *${appt.Service?.name || 'Servicio'}*. ¡Gracias por confirmar! 🗓️`
          ];
          text = templates[Math.floor(Math.random() * templates.length)];
        } else {
          // Cita NO confirmada: pedir confirmación
          const template = getRandomReminderTemplate();
          const intro = template.intro
            .replace('{name}', appt.clientName)
            .replace('{service}', appt.Service?.name || 'Servicio')
            .replace('{business}', appt.Business?.name || 'Negocio')
            .replace('{time}', timeStr);
          text = `${intro}\n\n${template.question}\nResponde *SI* para CONFIRMAR ✅\nResponde *NO* para CANCELAR ❌`;
          msgType = 'confirmation';
        }

        await scheduleMessage({
          businessId: appt.businessId,
          appointmentId: appt.id,
          phone: appt.clientPhone,
          message: text,
          type: msgType,
          scheduledAt: new Date()
        });
        
        if (!isConfirmed) {
          await appt.update({ 
            messageFlowStatus: 'awaiting_confirmation',
            reminder2hSent: true 
          });
          console.log(`[Reminder2h] 📅 Mensaje de CONFIRMACIÓN programado para cita ${appt.id}`);
        } else {
          await appt.update({ reminder2hSent: true });
          console.log(`[Reminder2h] 📅 Recordatorio amable programado para cita ${appt.id}`);
        }
      } else {
        // Sin teléfono o técnicos de campo, solo proceso normal (push/email)
        await processReminder(appt, '2 horas', 'reminder2hSent');
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
      if (processingAppts.has(appt.id)) continue;
      processingAppts.add(appt.id);

      // 1h: SIEMPRE recordatorio amable (sin pedir confirmación)
      if (appt.clientPhone && !appt.Business?.hasFieldTechnicians) {
        const isConfirmed = appt.confirmed === true || appt.status === 'confirmed';
        const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short', timeZone: 'America/Bogota' });
        
        // Recordatorio amable con diferentes plantillas
        const templates = isConfirmed 
          ? [
              `⏰ *${appt.clientName}*, te esperamos en 1 hora (${timeStr}) para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. ¡Todo listo! 🗓️`,
              `🎯 *${appt.clientName}*, recordatorio: tu cita confirmada es en *1 hora* (${timeStr}) en *${appt.Business?.name || 'Negocio'}*. ¡Nos vemos pronto! 😊`,
              `✅ *${appt.clientName}*, nos vemos en 1 hora (${timeStr}) para *${appt.Service?.name || 'Servicio'}*. ¡Gracias por confirmar! 🗓️`
            ]
          : [
              `⏰ *${appt.clientName}*, te esperamos en 1 hora (${timeStr}) para tu cita de *${appt.Service?.name || 'Servicio'}* en *${appt.Business?.name || 'Negocio'}*. ¡No faltes! 🗓️`,
              `🎯 *${appt.clientName}*, recordatorio: tu cita es en *1 hora* (${timeStr}) en *${appt.Business?.name || 'Negocio'}*. ¡Te esperamos! 😊`,
              `📅 *${appt.clientName}*, nos vemos en 1 hora (${timeStr}) para *${appt.Service?.name || 'Servicio'}*. ¡Puntual! 🗓️`
            ];
        const text = templates[Math.floor(Math.random() * templates.length)];

        await scheduleMessage({
          businessId: appt.businessId,
          appointmentId: appt.id,
          phone: appt.clientPhone,
          message: text,
          type: 'reminder',
          scheduledAt: new Date()
        });
        
        await appt.update({ reminderSent: true });
        console.log(`[Reminder1h] 📅 Recordatorio amable programado para cita ${appt.id}`);
      } else {
        // Sin teléfono o técnicos de campo
        await processReminder(appt, '1 hora', 'reminderSent');
      }
    }

    // ─── MENSAJE DE REFERENCIA (A LA HORA EXACTA DE LA CITA) ───
    // Se envía cuando la cita está a punto de empezar (±2 minutos)
    const winRefStart = new Date(now - (2 * 60 * 1000)); // 2 min antes
    const winRefEnd = new Date(now + (2 * 60 * 1000));  // 2 min después

    const apptsRef = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: winRefEnd, [Op.gte]: winRefStart },
        status: { [Op.in]: ['confirmed'] }, // Solo citas confirmadas
        referenceMessageSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business },
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of apptsRef) {
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processReferenceMessage(appt);
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

    // ─── NOTIFICACIONES ESPECIALES PARA TÉCNICOS DE CAMPO ───
    // Solo para negocios con hasFieldTechnicians=true
    // Notificaciones push al técnico: 60min, 30min, 15min antes
    await sendTechnicianFieldReminders(now, processingAppts);

  } catch (e) {
    console.error('[Reminder] ❌ Error en ciclo de recordatorios:', e.message);
  }
}

async function processReminder24h(appt) {
  try {
    const businessName = appt.Business?.name || 'KDice';
    const serviceName = appt.Service?.name || 'Servicio';
    const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short', ...COLOMBIA_TIME_OPTIONS });

    // Determinar si la cita YA está confirmada
    const isConfirmed = appt.confirmed === true;
    
    // 1. Push al cliente
    let clientPushToken = appt.Client?.pushToken;
    if (!clientPushToken && appt.clientEmail) {
      const guestDevice = await ClientDevice.findOne({ where: { email: appt.clientEmail.toLowerCase().trim() } });
      clientPushToken = guestDevice?.pushToken;
    }

    if (clientPushToken) {
      const title = isConfirmed ? `📅 Recordatorio: Cita mañana` : `📅 Confirma tu cita de mañana`;
      const body = isConfirmed 
        ? `Tienes una cita para ${serviceName} en ${businessName} mañana a las ${timeStr}.`
        : `Tienes una cita para ${serviceName} en ${businessName} mañana a las ${timeStr}. Responde SI para confirmar o NO para cancelar.`;
      
      await sendPushNotification(clientPushToken, { title, body }, { 
        type: isConfirmed ? 'appointment_reminder_24h' : 'appointment_confirm_24h', 
        appointmentId: appt.id 
      });
    }

    // 2. WhatsApp al cliente
    // Omitir WhatsApp para negocios con técnicos de campo
    if (appt.clientPhone && !appt.Business?.hasFieldTechnicians) {
      let text;
      let msgType = 'reminder';
      
      if (isConfirmed) {
        // Cita YA confirmada: recordatorio amable con diferentes plantillas
        const templates = [
          `👋 Hola *${appt.clientName}*, te esperamos mañana a las *${timeStr}* para tu cita de *${serviceName}* en *${businessName}*. ¡Gracias por confirmar! 🗓️`,
          `🎯 *${appt.clientName}*, todo listo para mañana a las *${timeStr}*. Tu cita de *${serviceName}* en *${businessName}* está confirmada. ¡Te esperamos! 😊`,
          `✅ Confirmado *${appt.clientName}*! Nos vemos mañana a las *${timeStr}* para tu cita de *${serviceName}* en *${businessName}*. 🗓️`
        ];
        text = templates[Math.floor(Math.random() * templates.length)];
      } else {
        // Cita NO confirmada: pedir confirmación
        text = `👋 Hola *${appt.clientName}*, tienes una cita para *${serviceName}* mañana a las *${timeStr}* en *${businessName}*.\n\n¿Confirmas tu asistencia?\nResponde: *SI* para confirmar\nResponde: *NO* para cancelar`;
        msgType = 'confirmation';
      }

      await scheduleMessage({
        businessId: appt.businessId,
        appointmentId: appt.id,
        phone: appt.clientPhone,
        message: text,
        type: msgType,
        scheduledAt: new Date()
      });
      
      if (!isConfirmed) {
        await appt.update({ 
          reminder24hSent: true,
          messageFlowStatus: 'awaiting_confirmation'
        });
        console.log(`[Reminder24h] 📅 Mensaje de CONFIRMACIÓN programado para cita ${appt.id}`);
      } else {
        await appt.update({ reminder24hSent: true });
        console.log(`[Reminder24h] 📅 Recordatorio amable programado para cita ${appt.id}`);
      }
    } else {
      // Sin WhatsApp: solo marcar como enviado
      await appt.update({ reminder24hSent: true });
    }

    console.log(`[Reminder24h] ✅ Recordatorio 24h completado para cita ${appt.id}`);
  } catch (e) {
    console.error(`[Reminder24h] ❌ Error procesando cita ${appt.id}:`, e.message);
  }
}

async function processReminder12h(appt) {
  try {
    const businessName = appt.Business?.name || 'KDice';
    const serviceName = appt.Service?.name || 'Servicio';
    const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short', ...COLOMBIA_TIME_OPTIONS });
    const dayText = getRelativeDayText(new Date(appt.startTime), timeStr);

    // Determinar estado de confirmación
    const isConfirmed = appt.confirmed === true;
    const alreadyAskingForConfirmation = appt.messageFlowStatus === 'awaiting_confirmation';
    const needsConfirmation = !isConfirmed && !alreadyAskingForConfirmation;

    // 1. Push al cliente
    let clientPushToken = appt.Client?.pushToken;
    if (!clientPushToken && appt.clientEmail) {
      const guestDevice = await ClientDevice.findOne({ where: { email: appt.clientEmail.toLowerCase().trim() } });
      clientPushToken = guestDevice?.pushToken;
    }

    if (clientPushToken) {
      const dayTextPlain = dayText.replace(/\*/g, '');
      const title = needsConfirmation ? `⏰ Confirma tu cita` : `⏰ Recordatorio: Cita en 12 horas`;
      const body = needsConfirmation 
        ? `Tienes una cita para ${serviceName} en ${businessName} ${dayTextPlain}. Responde SI para confirmar o NO para cancelar.`
        : `Tienes una cita para ${serviceName} en ${businessName} ${dayTextPlain}.`;
      
      await sendPushNotification(clientPushToken, { title, body }, { 
        type: needsConfirmation ? 'appointment_confirm_12h' : 'appointment_reminder_12h', 
        appointmentId: appt.id 
      });
    }

    // 2. WhatsApp al cliente
    // Omitir WhatsApp para negocios con técnicos de campo
    if (appt.clientPhone && !appt.Business?.hasFieldTechnicians) {
      let text;
      let msgType = 'reminder';
      
      if (isConfirmed) {
        // Cita YA confirmada: recordatorio amable con diferentes plantillas
        const templates = [
          `👋 Hola *${appt.clientName}*, te esperamos ${dayText} para tu cita de *${serviceName}* en *${businessName}*. ¡Gracias por confirmar! 🗓️`,
          `🎯 *${appt.clientName}*, todo listo para tu cita de *${serviceName}* ${dayText} en *${businessName}*. ¡Te esperamos con gusto! 😊`,
          `✅ Confirmado *${appt.clientName}*! Tu cita de *${serviceName}* es ${dayText} en *${businessName}*. ¡Nos vemos pronto! 🗓️`
        ];
        text = templates[Math.floor(Math.random() * templates.length)];
      } else {
        // Cita NO confirmada: pedir confirmación
        text = `👋 Hola *${appt.clientName}*, tienes una cita para *${serviceName}* ${dayText} en *${businessName}*.\n\n¿Confirmas tu asistencia?\nResponde: *SI* para confirmar\nResponde: *NO* para cancelar`;
        msgType = 'confirmation';
      }

      await scheduleMessage({
        businessId: appt.businessId,
        appointmentId: appt.id,
        phone: appt.clientPhone,
        message: text,
        type: msgType,
        scheduledAt: new Date()
      });
      
      if (!isConfirmed) {
        await appt.update({ 
          reminder12hSent: true,
          messageFlowStatus: 'awaiting_confirmation'
        });
        console.log(`[Reminder12h] 📅 Mensaje de CONFIRMACIÓN programado para cita ${appt.id}`);
      } else {
        await appt.update({ reminder12hSent: true });
        console.log(`[Reminder12h] 📅 Recordatorio amable programado para cita ${appt.id}`);
      }
    } else {
      // Sin WhatsApp
      await appt.update({ reminder12hSent: true });
    }

    console.log(`[Reminder12h] ✅ Recordatorio 12h completado para cita ${appt.id}`);
  } catch (e) {
    console.error(`[Reminder12h] ❌ Error procesando cita ${appt.id}:`, e.message);
  }
}

async function processReminder(appt, timeLabel, fieldToUpdate) {
  try {
    const businessName = appt.Business?.name || 'KDice';
    const serviceName = appt.Service?.name || 'Servicio';
    const employeeName = appt.Employee?.User?.name || 'Profesional';
    const startTimeStr = new Date(appt.startTime).toLocaleString('es-CO', { timeStyle: 'short', ...COLOMBIA_TIME_OPTIONS });
    const timeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short', ...COLOMBIA_TIME_OPTIONS });

    // Determinar estado de confirmación
    const isConfirmed = appt.confirmed === true;
    const is2h = timeLabel === '2 horas';
    const is1h = timeLabel === '1 hora';

    // 1. Email al cliente (si es de 1h o 2h) - NO bloquear si falla
    if (is1h || is2h) {
      try {
        let clientEmail = appt.clientEmail;
        if (!clientEmail && appt.clientId) {
          const clientUser = await User.findByPk(appt.clientId);
          clientEmail = clientUser?.email;
        }
        if (clientEmail) {
          const emailSubject = is2h && !isConfirmed ? 'Confirma tu cita (2 horas)' : `Recordatorio: Cita en ${timeLabel}`;
          await sendEmail(clientEmail, 'appointmentReminder', {
            clientName: String(appt.clientName || ''),
            businessName: String(businessName),
            serviceName: String(serviceName),
            employeeName: String(employeeName),
            startTime: String(appt.startTime),
            needsConfirmation: is2h && !isConfirmed,
          });
          console.log(`[Reminder] ✅ Email enviado a ${clientEmail}`);
        }
      } catch (emailErr) {
        console.log(`[Reminder] ⚠️ Email falló (ignorado): ${emailErr.message}`);
      }
    }

    // 1.5 WhatsApp al cliente (programar para envío)
    // Omitir WhatsApp para negocios con técnicos de campo
    if (appt.clientPhone && !appt.Business?.hasFieldTechnicians) {
      let text;
      let msgType = 'reminder';
      
      if (is2h && !isConfirmed) {
        // Última oportunidad para confirmar (2 horas antes)
        text = `⏰ *${appt.clientName}*, tu cita para *${serviceName}* en *${businessName}* es en *2 horas* (${timeStr}).\n\n⚠️ *IMPORTANTE:* Aún no has confirmado tu asistencia.\n\nResponde *SI* para confirmar ahora\nResponde *NO* si no podrás asistir\n\n¡Tu confirmación es importante! 🗓️`;
        msgType = 'confirmation';
      } else if (is1h && !isConfirmed) {
        // 1 hora antes sin confirmar: recordatorio de cortesía (ya es tarde para cancelar formalmente)
        text = `⏰ *${appt.clientName}*, recordatorio: tu cita para *${serviceName}* en *${businessName}* es en *1 hora* (${timeStr}).\n\nNota: Aún no has confirmado tu asistencia. Por favor llega puntual.\n\n¡Te esperamos! 🗓️`;
      } else {
        // Confirmada o cualquier otro caso: recordatorio normal
        text = `⏰ *${appt.clientName}*, tu cita para *${serviceName}* en *${businessName}* es *${timeLabel}* (${timeStr}).\n\n¡Te esperamos! 🗓️`;
      }

      await scheduleMessage({
        businessId: appt.businessId,
        appointmentId: appt.id,
        phone: appt.clientPhone,
        message: text,
        type: msgType,
        scheduledAt: new Date()
      });
      console.log(`[Reminder] 📱 WhatsApp programado para ${timeLabel}${is2h && !isConfirmed ? ' con CONFIRMACIÓN' : ''}`);
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

/**
 * Procesa mensaje de referencia enviado a la hora exacta de la cita
 * Incluye enlace para acceder a la información de la cita
 */
async function processReferenceMessage(appt) {
  try {
    const businessName = appt.Business?.name || 'KDice';
    const serviceName = appt.Service?.name || 'Servicio';
    const employeeName = appt.Employee?.User?.name || 'Profesional';
    const startTimeStr = new Date(appt.startTime).toLocaleString('es-CO', { timeStyle: 'short', ...COLOMBIA_TIME_OPTIONS });

    // 1. Push al cliente
    let clientPushToken = appt.Client?.pushToken;
    if (!clientPushToken && appt.clientEmail) {
      const guestDevice = await ClientDevice.findOne({ where: { email: appt.clientEmail.toLowerCase().trim() } });
      clientPushToken = guestDevice?.pushToken;
    }

    if (clientPushToken) {
      await sendPushNotification(clientPushToken, {
        title: `🕐 Es la hora de tu cita`,
        body: `Tu cita para ${serviceName} con ${employeeName} en ${businessName} está comenzando.`,
      }, { type: 'appointment_reference', appointmentId: appt.id });
    }

    // 2. WhatsApp al cliente (Mensaje de referencia a la hora exacta)
    // Omitir WhatsApp para negocios con técnicos de campo
    if (appt.clientPhone && !appt.Business?.hasFieldTechnicians) {
      const API_URL = process.env.API_URL || 'https://api-reservas.k-dice.com';
      const statusUrl = `${API_URL}/api/appointments/${appt.id}/status`;

      const text = `🕐 *${appt.clientName}*, es la hora de tu cita para *${serviceName}* en *${businessName}* con *${employeeName}*.

✅ Cita confirmada - ${startTimeStr}

📍 Puedes ver el estado de tu cita aquí: ${statusUrl}

¡Te esperamos! 💫`;

      // Programar mensaje en BD (se enviará cuando el scheduler procese dentro del horario 7am-8pm)
      await scheduleMessage({
        businessId: appt.businessId,
        appointmentId: appt.id,
        phone: appt.clientPhone,
        message: text,
        type: 'reminder',
        scheduledAt: new Date() // Enviar lo antes posible
      });
      console.log(`[Reference] 📅 Mensaje de referencia programado para cita ${appt.id}`);
    }

    // Marcar como enviado
    await appt.update({ referenceMessageSent: true });
    console.log(`[Reference] ✅ Mensaje de referencia enviado para cita ${appt.id}`);
  } catch (e) {
    console.error(`[Reference] ❌ Error procesando cita ${appt.id}:`, e.message);
  }
}

/**
 * Envía notificaciones push específicas a técnicos de campo
 * 60min, 30min, 15min antes de la cita
 */
async function sendTechnicianFieldReminders(now, processingAppts) {
  try {
    // ─── 60 MINUTOS ───
    const win60MEnd = new Date(now + REMINDER_60M_MS + (5 * 60 * 1000));
    const appts60M = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: win60MEnd, [Op.gt]: new Date(now) },
        status: { [Op.in]: ['pending', 'confirmed'] },
        pendingAlert60mSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business, where: { hasFieldTechnicians: true } }, // Solo negocios con técnicos de campo
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of appts60M) {
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processTechnicianReminder(appt, '60 minutos', 'pendingAlert60mSent', '🚨 ¡En 1 hora!');
      }
    }

    // ─── 30 MINUTOS ───
    const win30MTechEnd = new Date(now + REMINDER_30M_MS + (5 * 60 * 1000));
    const appts30MTech = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: win30MTechEnd, [Op.gt]: new Date(now) },
        status: { [Op.in]: ['pending', 'confirmed'] },
        pendingAlert30mSent: false,
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business, where: { hasFieldTechnicians: true } },
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of appts30MTech) {
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processTechnicianReminder(appt, '30 minutos', 'pendingAlert30mSent', '⏰ ¡En 30 minutos!');
      }
    }

    // ─── 15 MINUTOS ───
    const win15MEnd = new Date(now + REMINDER_15M_MS + (5 * 60 * 1000));
    const appts15M = await Appointment.findAll({
      where: {
        startTime: { [Op.lte]: win15MEnd, [Op.gt]: new Date(now) },
        status: { [Op.in]: ['pending', 'confirmed'] },
        pendingAlertSent: false, // Usamos el campo existente para 15min
      },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business, where: { hasFieldTechnicians: true } },
        { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
      ],
    });

    for (const appt of appts15M) {
      if (!processingAppts.has(appt.id)) {
        processingAppts.add(appt.id);
        await processTechnicianReminder(appt, '15 minutos', 'pendingAlertSent', '🔥 ¡Ya casi! 15 min');
      }
    }
  } catch (e) {
    console.error('[TechnicianReminders] ❌ Error:', e.message);
  }
}

/**
 * Procesa notificación push para técnico de campo
 */
async function processTechnicianReminder(appt, timeLabel, fieldToUpdate, alertEmoji) {
  try {
    const businessName = appt.Business?.name || 'KDice';
    const serviceName = appt.Service?.name || 'Servicio';
    const clientName = appt.clientName || 'Cliente';
    const startTimeStr = new Date(appt.startTime).toLocaleTimeString('es-CO', { timeStyle: 'short', ...COLOMBIA_TIME_OPTIONS });

    // Push SOLO al empleado (técnico) - no al cliente
    const employeePushToken = appt.Employee?.User?.pushToken;
    if (employeePushToken) {
      await sendPushNotification(employeePushToken, {
        title: `${alertEmoji} Tienes cita en ${timeLabel}`,
        body: `Cliente: ${clientName} - ${serviceName} a las ${startTimeStr}`,
      }, { 
        type: 'technician_field_reminder', 
        appointmentId: appt.id,
        urgency: timeLabel === '15 minutos' ? 'high' : 'normal'
      });
      console.log(`[TechnicianReminder] ✅ Notificación ${timeLabel} enviada a técnico para cita ${appt.id}`);
    }

    // Marcar como enviado
    await appt.update({ [fieldToUpdate]: true });
  } catch (e) {
    console.error(`[TechnicianReminder] ❌ Error procesando cita ${appt.id}:`, e.message);
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
