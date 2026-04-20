const { Appointment, Service, Employee, User, Business, Promotion, ClientTag, ClientTagAssignment, AppointmentNote, AppointmentEmployee, Deposit, sequelize } = require('../models');
const { Op } = require('sequelize');
const { sendEmail } = require('../config/email');
const { generatePaymentReceipt } = require('../utils/pdfGenerator');
const { sendCancellationNotification, sendPushNotification } = require('../services/pushNotificationService');
const { scheduleMessage } = require('../services/schedulerService');
const { emitNewAppointment, emitAppointmentUpdate, emitAppointmentCancelled } = require('../services/socketService');

// Zona horaria Colombia: UTC-5 (no cambia con horario de verano)
const COLOMBIA_OFFSET_MS = -5 * 60 * 60 * 1000;

/**
 * Dado un string de fecha "YYYY-MM-DD", construye un objeto Date que representa
 * la medianoche en Colombia (UTC-5), sin importar la zona del servidor.
 */
function colombiaDateFromString(dateStr) {
  // dateStr = "2026-03-24"
  // Medianoche Colombia = 05:00 UTC del mismo día
  return new Date(dateStr + 'T00:00:00-05:00');
}

/**
 * Construye un Date UTC a partir de una fecha "YYYY-MM-DD" y hora "HH:MM"
 * interpretados en zona horaria Colombia (UTC-5).
 */
function colombiaDateTimeToUTC(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00-05:00`);
}

/**
 * Obtiene el día de la semana en Colombia para una fecha dada.
 * 0=Domingo, 1=Lunes, ..., 6=Sábado
 */
function getDayOfWeekColombia(dateStr) {
  const d = colombiaDateFromString(dateStr);
  // Ajustamos al offset de Colombia para obtener el día local
  const localMs = d.getTime() + COLOMBIA_OFFSET_MS;
  const localDate = new Date(localMs);
  return localDate.getUTCDay();
}

exports.getByBusiness = async (req, res) => {
  try {
    const businessId = req.query.businessId || req.params.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const { date, startDate, endDate, employeeId } = req.query;
    const where = { businessId };
    if (employeeId) where.employeeId = employeeId;
    
    if (date) {
      // Filtrar por fecha única (día específico en zona horaria Colombia)
      const d = new Date(`${date}T00:00:00-05:00`);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      where.startTime = { [Op.between]: [d, next] };
    } else if (startDate && endDate) {
      // Filtrar por rango de fechas (para la agenda semanal)
      const start = new Date(`${startDate}T00:00:00-05:00`);
      const end = new Date(`${endDate}T23:59:59-05:00`);
      where.startTime = { [Op.between]: [start, end] };
    }

    const appointments = await Appointment.findAll({
      where,
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
      ],
      order: [['startTime', 'ASC']]
    });

    // Asegurar que workReport se incluya en la respuesta
    const appointmentsWithReport = appointments.map(a => {
      const json = a.toJSON();
      return json;
    });

    res.json(appointmentsWithReport);
  } catch (e) {
    console.error('[getByBusiness] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.getConsolidated = async (req, res) => {
  try {
    const userId = req.user.id;
    // 1. Buscar el negocio principal (si es el dueño) o el negocio asignado (si es manager)
    let mainBiz = await Business.findOne({ where: { ownerId: userId, isBranch: false } });
    
    if (!mainBiz) {
      const emp = await Employee.findOne({ where: { userId, isManager: true } });
      if (emp) {
        mainBiz = await Business.findByPk(emp.businessId);
      }
    }

    if (!mainBiz) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Si es una sucursal, el "consolidado" para ese manager son solo sus propias citas
    // Si es el negocio principal, traemos todas las sucursales
    let businessIds = [mainBiz.id];
    
    if (!mainBiz.isBranch) {
      const branches = await Business.findAll({ 
        where: { parentBusinessId: mainBiz.id },
        attributes: ['id']
      });
      businessIds = [...businessIds, ...branches.map(b => b.id)];
    }

    // 2. Traer todas las citas de esos negocios
    const appointments = await Appointment.findAll({
      where: { businessId: { [Op.in]: businessIds } },
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
      ],
      order: [['startTime', 'DESC']]
    });

    // Asegurar que workReport se incluya en la respuesta
    const appointmentsWithReport = appointments.map(a => a.toJSON());

    res.json(appointmentsWithReport);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getMyAppointments = async (req, res) => {
  try {
    const emp = await Employee.findOne({ where: { userId: req.user.id } });
    if (!emp) return res.status(404).json({ error: 'Perfil de empleado no encontrado' });

    const appointments = await Appointment.findAll({
      where: {
        [Op.or]: [
          { employeeId: emp.id },
          { '$AdditionalEmployees.employeeId$': emp.id }
        ],
        status: { [Op.in]: ['pending', 'confirmed', 'attention'] }
      },
      include: [
        { model: Service },
        { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
      ],
      order: [['startTime', 'ASC']]
    });
    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getMyClientAppointments = async (req, res) => {
  try {
    const { email } = req.query;
    let clientId = req.user?.id;

    // Si no hay clientId (por el token) pero viene un email (modo cliente simplificado en APK)
    const where = {};
    if (clientId) {
      where.clientId = clientId;
    } else if (email) {
      where.clientEmail = email.toLowerCase().trim();
    } else {
      return res.status(400).json({ error: 'Se requiere identificación de cliente' });
    }

    const appointments = await Appointment.findAll({
      where,
      include: [
        { model: Service },
        { model: Business, attributes: ['id', 'name', 'slug'] },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] }
      ],
      order: [['startTime', 'DESC']]
    });
    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { businessId, serviceId, employeeId, clientName, clientPhone, clientEmail, startTime, notes, status, additionalEmployeeIds, depositAmount, depositAccepted } = req.body;
    const additionalEmployees = additionalEmployeeIds || []; // Array de UUIDs de empleados adicionales

    console.log('[Create Appointment] Datos recibidos:', {
      businessId, serviceId, employeeId, startTime, clientEmail, clientName, clientPhone, user: req.user?.id || 'no auth'
    });

    const service = await Service.findByPk(serviceId);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

    // ========== VALIDACIÓN: El empleado debe tener el servicio asignado (o ser generalista) ==========
    if (employeeId) {
      const { EmployeeService } = require('../models');
      
      // Verificar que el empleado existe y está activo
      const employee = await Employee.findOne({
        where: { id: employeeId, businessId, active: true }
      });
      
      if (!employee) {
        return res.status(404).json({ error: 'Empleado no encontrado o inactivo' });
      }
      
      // Verificar si el empleado tiene ALGÚN servicio asignado
      const employeeServicesCount = await EmployeeService.count({
        where: { employeeId }
      });
      
      // Si el empleado tiene servicios asignados, verificar que pueda hacer este específico
      if (employeeServicesCount > 0) {
        const hasService = await EmployeeService.findOne({
          where: { employeeId, serviceId }
        });
        
        if (!hasService) {
          console.log(`[Create Appointment] ❌ Empleado ${employeeId} no tiene asignado el servicio ${serviceId}`);
          return res.status(403).json({ 
            error: 'Este empleado no puede realizar el servicio seleccionado',
            details: 'El empleado no tiene asignado este servicio en su perfil'
          });
        }
        
        console.log(`[Create Appointment] ✅ Empleado ${employeeId} tiene el servicio ${serviceId} asignado`);
      } else {
        // El empleado no tiene servicios asignados = es generalista, puede hacer cualquier servicio
        console.log(`[Create Appointment] ✅ Empleado ${employeeId} es generalista (sin servicios asignados), puede hacer cualquier servicio`);
      }
    }
    // =============================================================================

    // Asegurar que la hora se interprete como Colombia (UTC-5) si no viene con zona horaria
    let startTimeWithOffset = startTime;
    if (typeof startTime === 'string' && !startTime.includes('Z') && !startTime.match(/[+-]\d{2}:\d{2}$/)) {
      startTimeWithOffset = startTime + '-05:00'; // Colombia UTC-5
    }
    const start = new Date(startTimeWithOffset);
    const end = new Date(start.getTime() + service.durationMin * 60000);
    console.log('[Create Appointment] Checking conflict:', { employeeId, start: start.toISOString(), end: end.toISOString(), originalStartTime: startTime });

    // Verificar conflictos SOLO si no es cita express (status='attention')
    // Las citas express son para atención inmediata y no deben ser bloqueadas
    const isExpress = status === 'attention';
    
    if (!isExpress) {
      const conflict = await Appointment.findOne({
        where: {
          employeeId,
          businessId,
          status: { [Op.notIn]: ['cancelled'] },
          startTime: { [Op.lt]: end },
          endTime: { [Op.gt]: start },
        }
      });
      if (conflict) return res.status(409).json({ error: 'El empleado ya tiene una cita en ese horario' });
    }

    // CALCULAR PRECIO CON PROMOCIONES
    const now = new Date();
    const promotion = await Promotion.findOne({
      where: {
        businessId,
        active: true,
        startDate: { [Op.lte]: now },
        endDate: { [Op.gte]: now },
        [Op.or]: [
          { serviceId },
          { applyToAllServices: true }
        ]
      },
      order: [['applyToAllServices', 'ASC']] // Priorizar promociones específicas sobre las generales
    });

    const basePrice = parseFloat(service.price || 0);
    let discountApplied = 0;
    let promotionId = null;

    if (promotion) {
      promotionId = promotion.id;
      if (promotion.discountType === 'percentage') {
        discountApplied = basePrice * (parseFloat(promotion.discountValue) / 100);
      } else {
        discountApplied = parseFloat(promotion.discountValue);
      }
    }

    const finalPrice = Math.max(0, basePrice - discountApplied);

    const cleanPhone = clientPhone ? clientPhone.replace(/\D/g, '').slice(-10) : null;

    // Verificar que los empleados adicionales existan y estén activos
    if (additionalEmployees.length > 0) {
      for (const addEmpId of additionalEmployees) {
        const addEmp = await Employee.findOne({
          where: { id: addEmpId, businessId, active: true }
        });
        if (!addEmp) {
          return res.status(404).json({ error: `Empleado adicional no encontrado o inactivo: ${addEmpId}` });
        }
        
        // Verificar que no sea el mismo empleado principal
        if (addEmpId === employeeId) {
          return res.status(400).json({ error: 'No puede agregar el empleado principal como adicional' });
        }
        
        // Verificar que el empleado adicional no tenga conflicto de horario
        const addEmpConflict = await Appointment.findOne({
          where: {
            employeeId: addEmpId,
            businessId,
            status: { [Op.notIn]: ['cancelled'] },
            startTime: { [Op.lt]: end },
            endTime: { [Op.gt]: start },
          }
        });
        if (addEmpConflict && !isExpress) {
          return res.status(409).json({ error: `El empleado adicional ya tiene una cita en ese horario` });
        }
      }
    }

    const appt = await Appointment.create({
      businessId, serviceId, employeeId, clientName,
      clientPhone: cleanPhone,
      clientEmail: clientEmail ? clientEmail.toLowerCase().trim() : null,
      clientId: (req.user && req.user.role === 'client') ? req.user.id : (req.body.clientId || null),
      startTime: start, endTime: end, notes,
      status: status || 'pending',
      basePrice, discountApplied, finalPrice, promotionId
    });

    // Generar código de referencia único para WhatsApp
    try {
      const { generateUniqueReferenceCode } = require('../utils/referenceCode');
      const referenceCode = await generateUniqueReferenceCode();
      await appt.update({ referenceCode });
      console.log('[Create Appointment] Código de referencia generado:', referenceCode);
    } catch (refError) {
      console.error('[Create Appointment] Error generando código de referencia:', refError.message);
      // No fallar la creación de cita si el código falla
    }
    
    // Crear registros de empleados adicionales
    if (additionalEmployees.length > 0) {
      const appointmentEmployees = additionalEmployees.map((addEmpId, index) => ({
        appointmentId: appt.id,
        employeeId: addEmpId,
        role: index === 0 ? 'auxiliar' : 'apoyo'
      }));
      await AppointmentEmployee.bulkCreate(appointmentEmployees);
      console.log('[Create Appointment] Empleados adicionales agregados:', additionalEmployees.length);
    }
    
    // Crear depósito automáticamente si hay anticipo aceptado
    if (depositAccepted && depositAmount > 0) {
      try {
        await Deposit.create({
          businessId,
          appointmentId: appt.id,
          clientName,
          clientPhone: cleanPhone,
          amount: parseFloat(depositAmount),
          date: new Date().toISOString().split('T')[0],
          paymentMethod: 'cash', // Por defecto, se actualizará cuando se confirme el pago
          status: 'held',
          notes: `Anticipo generado automáticamente al crear cita. Pendiente de pago.`,
          createdBy: req.user?.id
        });
        console.log('[Create Appointment] Depósito creado automáticamente:', depositAmount);
      } catch (depositError) {
        console.error('[Create Appointment] Error creando depósito:', depositError);
        // No fallar la creación de cita si el depósito falla
      }
    }
    
    console.log('[Create Appointment] Cita creada exitosamente:', {
      id: appt.id,
      businessId: appt.businessId,
      startTime: appt.startTime,
      endTime: appt.endTime,
      status: appt.status,
      additionalEmployees: additionalEmployees.length
    });
    
    // Notificaciones automáticas (sin bloquear la respuesta)
    console.log('[Create Appointment] Iniciando notificaciones en setImmediate...');
    setImmediate(async () => {
      console.log('[Create Appointment] Ejecutando notificaciones...');
      try {
        console.log('[Create Appointment] Buscando cita con ID:', appt.id);
        const fullAppt = await Appointment.findByPk(appt.id, {
          include: [
            { model: Service },
            { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
            { model: Business },
          ],
        });
        console.log('[Create Appointment] Cita encontrada:', !!fullAppt);
        if (!fullAppt) {
          console.log('[Create Appointment] ERROR: No se encontró la cita');
          return;
        }
        
        // 🔔 EMITIR SOCKET PRIMERO - No bloquear por emails
        console.log('[Create Appointment] === EMITIENDO SOCKET INMEDIATAMENTE ===');
        try {
          console.log(`[Socket] Preparando emitir cita ${appt.id}:`, {
            businessId: fullAppt.businessId,
            employeeId: fullAppt.employeeId
          });
          
          await emitNewAppointment(fullAppt, {
            notifyEmployee: true,
            notifyAdmin: true
          });
          console.log(`[Socket] ✅ Cita ${appt.id} emitida en tiempo real`);
        } catch (socketErr) {
          console.error('[Socket] ❌ Error emitiendo cita:', socketErr.message);
        }
        
        // Resto de notificaciones (emails, push) - se ejecutan después sin bloquear
        console.log('[Create Appointment] Procesando notificaciones adicionales...');
        const owner = await User.findByPk(fullAppt.Business?.ownerId);
        
        // Enviar email al owner (sin await para no bloquear)
        if (owner?.email) {
          console.log('[Create Appointment] Enviando email a owner (async)...');
          sendEmail(owner.email, 'newAppointmentAdmin', {
            businessName: String(fullAppt.Business?.name || ''),
            clientName:   String(fullAppt.clientName || ''),
            serviceName:  String(fullAppt.Service?.name || ''),
            employeeName: String(fullAppt.Employee?.User?.name || ''),
            startTime:    String(fullAppt.startTime || ''),
          }).catch(e => console.error('[Email] Admin notify error:', e.message));
        }
        
        // Enviar push notification al dueño (async)
        if (owner?.pushToken) {
          sendPushNotification(owner.pushToken, {
            title: '📅 Nueva Cita Agendada',
            body: `${fullAppt.clientName || 'Cliente'} agendó ${fullAppt.Service?.name || 'servicio'}`,
          }, {
            type: 'new_appointment',
            appointmentId: fullAppt.id,
            businessName: String(fullAppt.Business?.name || ''),
          }).catch(e => console.error('[Push] Owner notify error:', e.message));
        }
        
        // Enviar push al empleado (async)
        if (fullAppt.Employee?.User?.pushToken) {
          sendPushNotification(fullAppt.Employee.User.pushToken, {
            title: '📅 Nueva Cita Asignada',
            body: `Tienes una cita con ${fullAppt.clientName || 'Cliente'}`,
          }, {
            type: 'new_appointment',
            appointmentId: fullAppt.id,
          }).catch(e => console.error('[Push] Employee notify error:', e.message));
        }
        
        // Email al cliente (async)
        let clientEmailTo = fullAppt.clientEmail;
        if (appt.clientId && !clientEmailTo) {
          const clientUser = await User.findByPk(appt.clientId);
          clientEmailTo = clientUser?.email || null;
        }
        if (clientEmailTo) {
          console.log('[Create Appointment] Enviando email al cliente (async)...');
          sendEmail(clientEmailTo, 'appointmentConfirmation', {
            clientName:   String(fullAppt.clientName || ''),
            businessName: String(fullAppt.Business?.name || ''),
            serviceName:  String(fullAppt.Service?.name || ''),
            employeeName: String(fullAppt.Employee?.User?.name || ''),
            startTime:    String(fullAppt.startTime || ''),
            price:        String(fullAppt.finalPrice || fullAppt.Service?.price || ''),
          }).catch(e => console.error('[Email] Client notify error:', e.message));
        }
        
        console.log('[Create Appointment] ✅ Notificaciones iniciadas (socket ya emitido)');
      } catch (e) {
        console.error('[Create Appointment] ❌ ERROR en notificaciones:', e.message, e.stack);
      }
    });

    res.status(201).json(appt);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const appt = await Appointment.findByPk(req.params.id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: Business },
        { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
      ],
    });
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    
    const oldStatus = appt.status;
    const updateData = { status: req.body.status };

    // Si se está completando la cita, guardar el método de pago si viene en el body
    if (req.body.status === 'done' && req.body.paymentMethod) {
      updateData.paymentMethod = req.body.paymentMethod;
    }

    // SI EL SERVICIO CAMBIÓ, RECALCULAR endTime BASADO EN LA DURACIÓN DEL NUEVO SERVICIO
    if (req.body.serviceId && req.body.serviceId !== appt.serviceId) {
      const newService = await Service.findByPk(req.body.serviceId);
      if (newService) {
        updateData.serviceId = newService.id;
        const start = new Date(appt.startTime);
        updateData.endTime = new Date(start.getTime() + newService.durationMin * 60000);
      }
    } else if (appt.Service) {
      // SI NO CAMBIÓ EL ID, PERO EL TIEMPO SIGUE SIENDO EL MISMO, 
      // ASEGURAR QUE endTime COINCIDA CON LA DURACIÓN ACTUAL DEL SERVICIO
      const start = new Date(appt.startTime);
      updateData.endTime = new Date(start.getTime() + appt.Service.durationMin * 60000);
    }

    await appt.update(updateData);

    // Si la cita se marca como completada, enviar comprobante de pago y solicitud de calificación
    if (req.body.status === 'done' && oldStatus !== 'done') {
      // Usar setImmediate para no bloquear la respuesta, luego setTimeout para el delay
      setImmediate(() => {
        setTimeout(async () => {
          try {
            console.log(`[Done Action] Iniciando procesamiento post-completado para cita ${appt.id}`);
            
            // Recargar cita para asegurar datos frescos
            const freshAppt = await Appointment.findByPk(appt.id, {
              include: [
                { model: Service },
                { model: Employee, include: [{ model: User, attributes: ['name'] }] },
                { model: Business },
                { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] },
              ]
            });

            if (!freshAppt) {
              console.error('[Done Action] Cita no encontrada al recargar');
              return;
            }

            // Enviar comprobante de pago (aislado en su propio try-catch)
            try {
              await sendPaymentReceipt(freshAppt);
              console.log(`[Done Action] Comprobante enviado para cita ${appt.id}`);
            } catch (receiptErr) {
              console.error('[Done Action] Error enviando comprobante:', receiptErr.message);
            }

            // Enviar solicitud de calificación por email
            try {
              await sendRatingEmail(freshAppt);
              console.log(`[Done Action] Solicitud de calificación por email enviada para cita ${appt.id}`);
            } catch (ratingEmailErr) {
              console.error('[Done Action] Error enviando solicitud de calificación por email:', ratingEmailErr.message);
            }
            
            // Enviar solicitud de calificación por WhatsApp (con 5 min de delay)
            if (freshAppt.clientPhone && !freshAppt.ratingSent) {
              try {
                const { WhatsAppSession, Business } = require('../models');
                const { Op } = require('sequelize');
                const { queueMessage, getRandomRatingTemplate } = require('../services/whatsappService');
                
                const resolvedBizId = await Business.resolveWhatsAppBusinessId(freshAppt.businessId);
                const session = await WhatsAppSession.findOne({ 
                  where: { 
                    businessId: resolvedBizId,
                    status: { [Op.in]: ['connected', 'session_saved'] }
                  } 
                });
                
                if (session) {
                  const employeeName = freshAppt.Employee?.User?.name || 'nuestro profesional';
                  const businessName = freshAppt.Business?.name || 'nosotros';
                  const businessSlug = freshAppt.Business?.slug || freshAppt.businessId;
                  const ratingTemplate = getRandomRatingTemplate();
                  
                  const baseUrl = process.env.FRONTEND_URL || 'https://k-dice.com';
                  const reviewLink = `${baseUrl}/${businessSlug}?review=true`;
                  
                  // Mensaje 1: Calificación del empleado (5 minutos después)
                  const serviceDate = new Date(freshAppt.startTime).toLocaleDateString('es-CO', { 
                    weekday: 'long', 
                    day: 'numeric', 
                    month: 'long' 
                  });
                  const ratingText = `¡Hola *${freshAppt.clientName}*! 👋\n\nGracias por tu visita el *${serviceDate}* a *${businessName}*.\n\n${ratingTemplate}\n\n💇 Servicio con: *${employeeName}*\n\nResponde con un número del *1 al 5* ⭐`;
                  console.log(`[Done Action] Programando calificación para cita ${freshAppt.id} (${serviceDate} - ${employeeName})`);
                  
                  // Mensaje 2: Calificación del negocio/reseña (1 hora después)
                  const reviewText = `¡Hola *${freshAppt.clientName}*! 👋\n\n¿Quieres ayudar a *${businessName}* a crecer?\n\n💬 Deja una reseña pública y ayuda a otros clientes a conocernos:\n👉 ${reviewLink}\n\n¡Gracias por tu confianza! ❤️`;
                  
                  // Programar calificación del empleado a los 5 minutos (persistente en BD)
                  await scheduleMessage({
                    businessId: freshAppt.businessId,
                    appointmentId: freshAppt.id,
                    phone: freshAppt.clientPhone,
                    message: ratingText,
                    type: 'rating',
                    scheduledAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutos
                  });
                  
                  // Marcar cita como rating programado y actualizar flujo de mensajes
                  await freshAppt.update({ 
                    ratingSent: true,
                    ratingSentAt: new Date(),
                    messageFlowStatus: 'awaiting_rating' // El sistema ahora espera calificación 1-5
                  });
                  console.log(`[Done Action] Cita ${freshAppt.id} marcada como awaiting_rating`);
                  
                  // Programar solicitud de reseña del negocio a las 2 horas
                  await scheduleMessage({
                    businessId: freshAppt.businessId,
                    appointmentId: freshAppt.id,
                    phone: freshAppt.clientPhone,
                    message: reviewText,
                    type: 'review',
                    scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 horas
                  });
                  
                  console.log(`[Done Action] Mensajes programados en BD: Calificación (5min) + Reseña (2h) para cita ${appt.id}`);
                } else {
                  console.log(`[Done Action] ℹ️ No se programa calificación: WhatsApp no configurado para el negocio ${freshAppt.businessId}`);
                }
              } catch (waErr) {
                console.error('[Done Action] Error programando solicitud de calificación:', waErr.message);
              }
            } else {
              if (!freshAppt.clientPhone) {
                console.log(`[Done Action] ℹ️ No se programa calificación: cita sin teléfono del cliente`);
              } else if (freshAppt.ratingSent) {
                console.log(`[Done Action] ℹ️ No se programa calificación: ya fue enviada anteriormente`);
              }
            }
            
            console.log(`[Done Action] Procesamiento completado para cita ${appt.id}`);
          } catch (e) {
            console.error('[Done Action] Error general:', e.message);
          }
        }, 5000); // Delay de 5 segundos para evitar colisiones
      });
    }

    // 🔔 EMITIR EVENTO SOCKET.IO - Actualización de estado en tiempo real
    setImmediate(async () => {
      try {
        const updateType = req.body.status === 'cancelled' ? 'cancelled' : 'updated';
        await emitAppointmentUpdate(appt, updateType);
        console.log(`[Socket] Cita ${appt.id} estado actualizado a ${req.body.status}`);
      } catch (socketErr) {
        console.error('[Socket] Error emitiendo actualización:', socketErr.message);
      }
    });

    res.json(appt);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// Función auxiliar para enviar comprobante de pago o orden de servicio
const sendPaymentReceipt = async (appointment) => {
  // Determinar el email del cliente
  let clientEmail = null;
  if (appointment.clientId) {
    const clientUser = await User.findByPk(appointment.clientId);
    clientEmail = clientUser?.email || null;
  }
  // Si no hay usuario registrado, usar el email proporcionado directamente
  if (!clientEmail && appointment.clientEmail) {
    clientEmail = appointment.clientEmail;
  }

  if (!clientEmail) {
    console.log('[Email] No se encontró email del cliente para enviar comprobante');
    return;
  }

  const isTechnicalService = appointment.Business?.isTechnicalServices || false;
  const orderNumber = appointment.id.substring(0, 8).toUpperCase();

    // Para servicios técnicos: enviar Orden de Servicio con PDF
    if (isTechnicalService) {
      console.log('[Email] Enviando Orden de Servicio para cita técnica:', appointment.id);
      
      const basePrice = parseFloat(appointment.Service?.price || 0);
      const additional = parseFloat(appointment.additionalAmount || 0);
      const totalPrice = basePrice + additional;

      // Generar PDF de Orden de Servicio
      const pdfBuffer = await generatePaymentReceipt({
        businessId: appointment.businessId,
        businessName: appointment.Business?.name,
        businessLogoUrl: appointment.Business?.logoUrl,
        businessAddress: appointment.Business?.address,
        businessPhone: appointment.Business?.phone,
        businessNit: appointment.Business?.nit,
        id: appointment.id,
        clientName: appointment.clientName,
        clientEmail: appointment.clientEmail,
        clientPhone: appointment.clientPhone,
        serviceName: appointment.Service?.name,
        serviceDescription: appointment.Service?.description,
        employeeName: appointment.Employee?.User?.name,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        price: basePrice, // Enviamos el base
        additionalAmount: additional, // El adicional por separado
        additionalNote: appointment.additionalNote, // El concepto del adicional
        paymentMethod: appointment.paymentMethod || 'Efectivo',
        notes: appointment.notes,
        isTechnicalService: true, // Flag para que el PDF genere OS en lugar de comprobante
      });
      
      await sendEmail(
        clientEmail,
        'serviceOrder',
        {
          clientName: appointment.clientName,
          businessName: appointment.Business?.name,
          serviceName: appointment.Service?.name,
          employeeName: appointment.Employee?.User?.name,
          startTime: appointment.startTime,
          price: totalPrice,
          orderNumber,
          notes: appointment.notes,
        },
      [
        {
          filename: `orden-servicio-${orderNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ]
    );
    return;
  }

  const basePrice = parseFloat(appointment.Service?.price || 0);
  const additional = parseFloat(appointment.additionalAmount || 0);
  const totalPrice = basePrice + additional;

  // Para servicios normales: enviar Comprobante de Pago con PDF
  const pdfBuffer = await generatePaymentReceipt({
    businessId: appointment.businessId,
    businessName: appointment.Business?.name,
    businessLogoUrl: appointment.Business?.logoUrl,
    businessAddress: appointment.Business?.address,
    businessPhone: appointment.Business?.phone,
    businessNit: appointment.Business?.nit,
    id: appointment.id,
    clientName: appointment.clientName,
    clientEmail: appointment.clientEmail,
    clientPhone: appointment.clientPhone,
    serviceName: appointment.Service?.name,
    serviceDescription: appointment.Service?.description,
    employeeName: appointment.Employee?.User?.name,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    price: basePrice, // Enviamos el base
    additionalAmount: additional, // El adicional por separado
    additionalNote: appointment.additionalNote, // El concepto del adicional
    paymentMethod: appointment.paymentMethod || 'Efectivo',
    notes: appointment.notes,
  });

  await sendEmail(
    clientEmail,
    'paymentReceipt',
    {
      clientName: appointment.clientName,
      businessName: appointment.Business?.name,
      serviceName: appointment.Service?.name,
      startTime: appointment.startTime,
      price: totalPrice,
      receiptNumber: orderNumber,
    },
    [
      {
        filename: `comprobante-${orderNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ]
  );
};

exports.cancel = async (req, res) => {
  try {
    const appt = await Appointment.findByPk(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (appt.status === 'done') return res.status(400).json({ error: 'No se puede cancelar una cita completada' });
    if (appt.status === 'cancelled') return res.status(400).json({ error: 'La cita ya está cancelada' });
    
    // Verificar permisos: admin, empleado asignado, o cliente dueño de la cita
    const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin');
    
    let isEmployee = false;
    if (req.user && req.user.role === 'employee') {
      const emp = await Employee.findOne({ where: { userId: req.user.id } });
      isEmployee = emp && appt.employeeId === emp.id;
    }

    const isOwnerByEmail = req.body.clientEmail && appt.clientEmail === req.body.clientEmail.toLowerCase().trim();
    const isOwnerByClientId = req.user && req.user.role === 'client' && appt.clientId === req.user.id;
    
    if (!isAdmin && !isEmployee && !isOwnerByEmail && !isOwnerByClientId) {
      return res.status(403).json({ error: 'No tienes permiso para cancelar esta cita' });
    }

    // Restricción de 12 horas solo para CLIENTES
    if (!isAdmin && !isEmployee && (isOwnerByEmail || isOwnerByClientId)) {
      const now = new Date();
      const apptTime = new Date(appt.startTime);
      
      // Diferencia en milisegundos
      const diffMs = apptTime.getTime() - now.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 12) {
        return res.status(400).json({ 
          error: 'No se puede cancelar la cita porque faltan menos de 12 horas. Por favor contacta al dueño del negocio para más información.' 
        });
      }
    }
    
    await appt.update({ status: 'cancelled' });
    
    // Enviar email al negocio si es cancelación por cliente
    if (!isAdmin && !isEmployee && (isOwnerByEmail || isOwnerByClientId)) {
      try {
        // Buscar la cita completa con relaciones
        const fullAppt = await Appointment.findByPk(req.params.id, {
          include: [
            { model: Service },
            { model: Employee, include: [{ model: User, attributes: ['name'] }] },
            { model: Business }
          ]
        });
        
        if (fullAppt && fullAppt.Business) {
          const owner = await User.findByPk(fullAppt.Business.ownerId);
          if (owner?.email) {
            await sendEmail(owner.email, 'appointmentCancelled', {
              businessName: String(fullAppt.Business.name || ''),
              clientName: String(fullAppt.clientName || ''),
              serviceName: String(fullAppt.Service?.name || ''),
              employeeName: String(fullAppt.Employee?.User?.name || 'No asignado'),
              startTime: fullAppt.startTime,
              cancelTime: new Date()
            });
          }
          
          // Enviar push notification al dueño si tiene FCM token
          if (owner?.pushToken) {
            await sendCancellationNotification(owner.pushToken, {
              id: fullAppt.id,
              clientName: String(fullAppt.clientName || ''),
              serviceName: String(fullAppt.Service?.name || ''),
              businessName: String(fullAppt.Business.name || ''),
              startTime: fullAppt.startTime,
            });
          }
          
          // Enviar push notification al empleado asignado si tiene FCM token
          if (fullAppt.Employee?.User?.pushToken) {
            await sendCancellationNotification(fullAppt.Employee.User.pushToken, {
              id: fullAppt.id,
              clientName: String(fullAppt.clientName || ''),
              serviceName: String(fullAppt.Service?.name || ''),
              businessName: String(fullAppt.Business.name || ''),
              startTime: fullAppt.startTime,
            });
          }
        }
      } catch (emailErr) {
        console.log('[Cancel] Email no enviado:', emailErr.message);
      }
    }

    // 🔔 EMITIR EVENTO SOCKET.IO - Cancelación en tiempo real
    setImmediate(async () => {
      try {
        // Buscar la cita completa para emitir
        const fullAppt = await Appointment.findByPk(req.params.id, {
          include: [
            { model: Service },
            { model: Employee, include: [{ model: User, attributes: ['name'] }] },
            { model: Business }
          ]
        });
        
        if (fullAppt) {
          const cancelledBy = req.user?.role || 'system';
          await emitAppointmentCancelled(fullAppt, cancelledBy);
          console.log(`[Socket] Cita ${appt.id} cancelación emitida`);
        }
      } catch (socketErr) {
        console.error('[Socket] Error emitiendo cancelación:', socketErr.message);
      }
    });
    
    res.json({ message: 'Cita cancelada', appt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.sendReceipt = async (req, res) => {
  try {
    const appt = await Appointment.findByPk(req.params.id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: Business },
      ],
    });
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (appt.status !== 'done') return res.status(400).json({ error: 'Solo se puede enviar comprobante de citas completadas' });

    await sendPaymentReceipt(appt);
    res.json({ message: 'Comprobante de pago enviado exitosamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getAvailability = async (req, res) => {
  try {
    const { date, employeeId, serviceId, businessId } = req.query;
    
    if (!date || !employeeId || !serviceId || !businessId) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    const { Appointment, Schedule, SpecialSchedule, EmployeeVacation, sequelize } = require('../models');
    const { Op } = require('sequelize');

    const service = await Service.findByPk(serviceId);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

    // Verificar si el empleado está de vacaciones en esta fecha
    const vacationCount = await EmployeeVacation.count({
      where: {
        employeeId,
        active: true,
        startDate: { [Op.lte]: date },
        endDate: { [Op.gte]: date }
      }
    });

    if (vacationCount > 0) {
      return res.json({ availableSlots: [] });
    }

    const duration = service.durationMin || 60;
    const nowColombia = new Date();
    const dayOfWeek = getDayOfWeekColombia(date);

    // Verificar si hay horarios especiales para esta fecha (festivos, días especiales)
    const [month, dayNum] = date.split('-').slice(1);
    
    const specialSchedules = await SpecialSchedule.findAll({
      where: {
        businessId,
        active: true,
        [Op.and]: [
          // Condición 1: Fecha exacta O fecha recurrente (mismo mes/día)
          {
            [Op.or]: [
              { specificDate: date },
              { 
                isRecurringYearly: true,
                [Op.and]: [
                  sequelize.where(
                    sequelize.fn('EXTRACT', sequelize.literal('MONTH FROM "specificDate"')),
                    parseInt(month)
                  ),
                  sequelize.where(
                    sequelize.fn('EXTRACT', sequelize.literal('DAY FROM "specificDate"')),
                    parseInt(dayNum)
                  )
                ]
              }
            ]
          },
          // Condición 2: Empleado específico O todos los empleados
          {
            [Op.or]: [
              { employeeId: employeeId },
              { employeeId: null }
            ]
          }
        ]
      }
    });

    let empSchedules;
    let workSchedules = [];
    let lunchRanges = [];
    let blockedRanges = [];

    // Si hay horarios especiales para esta fecha, usarlos en lugar de los regulares
    if (specialSchedules.length > 0) {
      // Verificar si el negocio/empleado está cerrado ese día
      const closedSchedule = specialSchedules.find(s => s.type === 'closed');
      if (closedSchedule) {
        return res.json({ availableSlots: [] });
      }

      // Filtrar por empleado específico o usar los generales
      const employeeSpecific = specialSchedules.filter(s => s.employeeId === employeeId);
      const generalOnes = specialSchedules.filter(s => s.employeeId === null);
      const schedulesToUse = employeeSpecific.length > 0 ? employeeSpecific : generalOnes;

      workSchedules = schedulesToUse.filter(s => s.type === 'work');
      lunchRanges = schedulesToUse.filter(s => s.type === 'lunch');
      blockedRanges = schedulesToUse.filter(s => s.type === 'blocked');

      // Convertir al formato esperado por el resto del código
      empSchedules = schedulesToUse;
    } else {
      // Usar horarios regulares por día de la semana
      empSchedules = await Schedule.findAll({
        where: { employeeId, dayOfWeek, active: true }
      });

      workSchedules = empSchedules.filter(s => {
        const type = (s.type || 'work').trim().toLowerCase();
        return type === 'work';
      });
      
      lunchRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch');
      blockedRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked');
    }

    if (workSchedules.length === 0) {
      return res.json({ availableSlots: [] });
    }

    const startOfDay = colombiaDateFromString(date);
    const endOfDay   = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const existingAppointments = await Appointment.findAll({
      where: {
        employeeId,
        businessId,
        status: { [Op.or]: [{ [Op.notIn]: ['cancelled'] }, { [Op.is]: null }] },
        startTime: { [Op.lt]: endOfDay },
        endTime:   { [Op.gt]: startOfDay }
      }
    });

    /**
     * Convierte un horario HH:MM a minutos desde medianoche.
     */
    const toMinutes = (timeStr) => {
      if (!timeStr) return 0;
      const cleanTime = String(timeStr).trim();
      const [h, m] = cleanTime.split(':').map(Number);
      return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
    };

    /**
     * Convierte un objeto Date o string ISO a minutos del día en Colombia.
     */
    const dateToMinutesColombia = (date) => {
      const d = new Date(date);
      // Ajustar al offset de Colombia
      const localMs = d.getTime() + COLOMBIA_OFFSET_MS;
      const localDate = new Date(localMs);
      return localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
    };

    /**
     * Verifica si el intervalo [slotStart, slotEnd) se solapa con [blockStart, blockEnd).
     */
    const overlaps = (slotStart, slotEnd, blockStart, blockEnd) => {
      return slotStart < blockEnd && slotEnd > blockStart;
    };

    const availableSlots = [];

    // Ordenar workSchedules por hora de inicio para procesar en orden cronológico
    workSchedules.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

    for (const sched of workSchedules) {
      const workStart = toMinutes(sched.startTime);
      const workEnd = toMinutes(sched.endTime);
      let current = workStart;

      const safeDuration = (duration && duration > 0) ? Number(duration) : 30;

      while (current + safeDuration <= workEnd) {
        const hh = String(Math.floor(current / 60)).padStart(2, '0');
        const mm = String(current % 60).padStart(2, '0');
        const timeStr = `${hh}:${mm}`;

        const slotTime = colombiaDateTimeToUTC(date, timeStr);
        const slotEndTime = new Date(slotTime.getTime() + safeDuration * 60000);

        // 1. Filtrar si ya pasó (solo si NO se permite horarios pasados)
        // Para empresas normales (admin creando citas retrospectivas) se pasa allowPast=true
        const allowPast = req.query.allowPast === 'true';
        if (!allowPast) {
          const MARGIN_MS = 5 * 60 * 1000;
          if (slotTime.getTime() <= (Date.now() - MARGIN_MS)) {
            current += 5;
            continue;
          }
        }

        // 2. Verificar Citas Existentes
        const conflictAppt = existingAppointments.find(appt => {
          const apptS = dateToMinutesColombia(appt.startTime);
          const apptE = dateToMinutesColombia(appt.endTime);
          return overlaps(current, current + safeDuration, apptS, apptE);
        });

        if (conflictAppt) {
          // Saltar al final de la cita
          current = dateToMinutesColombia(conflictAppt.endTime);
          continue;
        }

        // 3. Verificar Almuerzo y Bloqueos
        const conflictBlock = [...lunchRanges, ...blockedRanges].find(r => 
          overlaps(current, current + safeDuration, toMinutes(r.startTime), toMinutes(r.endTime))
        );

        if (conflictBlock) {
          const blockEnd = toMinutes(conflictBlock.endTime);
          // Si el bloqueo termina después de este workSchedule, salir del while
          // para pasar al siguiente bloque de trabajo
          if (blockEnd >= workEnd) {
            break;
          }
          // Saltar al final del bloqueo
          current = blockEnd;
          continue;
        }

        // 4. El slot está libre!
        availableSlots.push({
          time: timeStr,
          startTime: slotTime,
          endTime: slotEndTime
        });

        // Avanzar al siguiente intervalo según la duración del servicio
        current += safeDuration;
      }
    }

    // Eliminar duplicados (basado en el campo 'time')
    const seen = new Set();
    const uniqueSlots = availableSlots.filter(slot => {
      if (seen.has(slot.time)) return false;
      seen.add(slot.time);
      return true;
    }).sort((a, b) => a.time.localeCompare(b.time));

    res.json({ availableSlots: uniqueSlots });
  } catch (e) {
    console.error('Error en getAvailability:', e);
    res.status(500).json({ error: e.message });
  }
};

// Add or update additional charge to appointment
exports.addAdditionalCharge = async (req, res) => {
  try {
    const { id } = req.params;
    const { additionalAmount, additionalNote } = req.body;

    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: Business },
      ],
    });

    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });

    // Permisos: Admin o el empleado asignado a la cita
    const isAdmin = ['admin', 'admin_suc', 'superadmin'].includes(req.user.role);
    let isAssignedEmployee = false;

    if (req.user.role === 'employee') {
      const emp = await Employee.findOne({ where: { userId: req.user.id } });
      isAssignedEmployee = emp && appt.employeeId === emp.id;
    }

    if (!isAdmin && !isAssignedEmployee) {
      return res.status(403).json({ error: 'Sin permisos suficientes para modificar esta cita' });
    }

    // Validate additional amount
    const amount = parseFloat(additionalAmount);
    if (isNaN(amount) || amount < 0) {
      return res.status(400).json({ error: 'El monto adicional debe ser un número positivo' });
    }

    // Update appointment with additional charge
    await appt.update({
      additionalAmount: amount,
      additionalNote: additionalNote || null,
    });

    res.json({
      success: true,
      message: 'Cargo adicional agregado exitosamente',
      appointment: {
        id: appt.id,
        additionalAmount: amount,
        additionalNote: additionalNote,
        totalAmount: parseFloat(appt.Service?.price || 0) + amount,
      },
    });
  } catch (e) {
    console.error('Error adding additional charge:', e);
    res.status(500).json({ error: e.message });
  }
};

// Client confirms attendance (no auth required - link from email)
exports.confirmAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find appointment
    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business, include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'pushToken'] }] },
      ],
    });
    
    if (!appt) return res.status(404).send('<h1>Cita no encontrada</h1>');
    if (appt.status === 'cancelled') return res.status(400).send('<h1>Esta cita ya fue cancelada</h1>');
    
    // Update confirmation status
    await appt.update({ 
      confirmed: true, 
      confirmedAt: new Date(),
      reminder24hSent: true 
    });
    
    // Send push notification to admin
    const owner = appt.Business?.Owner;
    if (owner?.pushToken) {
      await sendPushNotification(owner.pushToken, {
        title: '✅ Cliente Confirmó Asistencia',
        body: `${appt.clientName} confirmó que asistirá a la cita de ${appt.Service?.name} el ${new Date(appt.startTime).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' })}`,
      }, {
        type: 'appointment_confirmed',
        appointmentId: appt.id,
        businessId: appt.businessId,
        clientName: appt.clientName,
      });
    }
    
    // Send confirmation email to client
    let clientEmail = null;
    if (appt.clientId) {
      const clientUser = await User.findByPk(appt.clientId);
      clientEmail = clientUser?.email || null;
    }
    if (!clientEmail && appt.clientEmail) {
      clientEmail = appt.clientEmail;
    }
    
    if (clientEmail) {
      await sendEmail(clientEmail, 'appointmentConfirmedByClient', {
        clientName: String(appt.clientName || ''),
        businessName: String(appt.Business?.name || ''),
        serviceName: String(appt.Service?.name || ''),
        employeeName: String(appt.Employee?.User?.name || ''),
        startTime: String(appt.startTime || ''),
      }).catch(e => console.error('[Email] Confirmation error:', e.message));
    }
    
    // HTML de respuesta "minimalista"
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Asistencia Confirmada</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
          .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px; }
          .icon { font-size: 3rem; margin-bottom: 1rem; }
          h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #10b981; }
          p { margin: 0; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>¡Asistencia Confirmada!</h1>
          <p>Gracias por confirmar tu asistencia a la cita en <strong>${appt.Business?.name || 'nuestro negocio'}</strong>.</p>
          <p style="margin-top: 1rem; font-size: 0.8rem;">Puedes cerrar esta pestaña ahora.</p>
        </div>
      </body>
      </html>
    `);
  } catch (e) {
    console.error('Error confirming attendance:', e);
    res.status(500).send('<h1>Error al confirmar asistencia</h1>');
  }
};

// Client cancels from email link
exports.cancelFromEmail = async (req, res) => {
  try {
    const { id } = req.params;
    
    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
        { model: Business, include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'pushToken', 'email'] }] },
      ],
    });
    
    if (!appt) return res.status(404).send('<h1>Cita no encontrada</h1>');
    if (appt.status === 'cancelled') return res.status(400).send('<h1>Esta cita ya fue cancelada anteriormente</h1>');
    
    // Actualizar estado a cancelada
    await appt.update({ status: 'cancelled' });
    
    // Notificar al dueño
    const owner = appt.Business?.Owner;
    if (owner) {
      // Push
      if (owner.pushToken) {
        await sendCancellationNotification(owner.pushToken, {
          id: appt.id,
          clientName: String(appt.clientName || ''),
          serviceName: String(appt.Service?.name || ''),
          businessName: String(appt.Business?.name || ''),
          startTime: appt.startTime,
        });
      }
      // Email
      if (owner.email) {
        await sendEmail(owner.email, 'appointmentCancelled', {
          businessName: String(appt.Business?.name || ''),
          clientName: String(appt.clientName || ''),
          serviceName: String(appt.Service?.name || ''),
          employeeName: String(appt.Employee?.User?.name || 'No asignado'),
          startTime: appt.startTime,
          cancelTime: new Date()
        });
      }
    }
    
    // HTML de respuesta
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cita Cancelada</title>
        <style>
          body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
          .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; max-width: 400px; }
          .icon { font-size: 3rem; margin-bottom: 1rem; }
          h1 { margin: 0 0 0.5rem; font-size: 1.5rem; color: #ef4444; }
          p { margin: 0; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">❌</div>
          <h1>Cita Cancelada</h1>
          <p>Tu cita en <strong>${appt.Business?.name || 'nuestro negocio'}</strong> ha sido cancelada exitosamente.</p>
          <p style="margin-top: 1rem; font-size: 0.8rem;">Puedes cerrar esta pestaña ahora.</p>
        </div>
      </body>
      </html>
    `);
  } catch (e) {
    console.error('Error cancelling from email:', e);
    res.status(500).send('<h1>Error al procesar la cancelación</h1>');
  }
};

// Transfer appointment to another employee (optionally with new time slot)
exports.transferAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { newEmployeeId, newStartTime } = req.body;

    if (!newEmployeeId) {
      return res.status(400).json({ error: 'newEmployeeId es requerido' });
    }

    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: Business },
      ],
    });

    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    if (appt.status === 'cancelled') return res.status(400).json({ error: 'No se puede transferir una cita cancelada' });
    if (appt.status === 'done') return res.status(400).json({ error: 'No se puede transferir una cita completada' });

    // Get new employee details
    const newEmployee = await Employee.findByPk(newEmployeeId, {
      include: [{ model: User, attributes: ['name', 'pushToken'] }]
    });
    if (!newEmployee) return res.status(404).json({ error: 'Empleado destino no encontrado' });
    if (newEmployee.businessId !== appt.businessId) {
      return res.status(400).json({ error: 'El empleado destino no pertenece a este negocio' });
    }

    // ========== VALIDACIÓN: El nuevo empleado debe tener el servicio asignado (o ser generalista) ==========
    const { EmployeeService } = require('../models');
    const serviceId = appt.serviceId;
    
    // Verificar si el empleado tiene ALGÚN servicio asignado
    const employeeServicesCount = await EmployeeService.count({
      where: { employeeId: newEmployeeId }
    });
    
    // Si el empleado tiene servicios asignados, verificar que pueda hacer este específico
    if (employeeServicesCount > 0) {
      const hasService = await EmployeeService.findOne({
        where: { employeeId: newEmployeeId, serviceId }
      });
      
      if (!hasService) {
        console.log(`[Transfer] ❌ Empleado ${newEmployeeId} no tiene asignado el servicio ${serviceId}`);
        return res.status(403).json({ 
          error: 'No se puede reasignar la cita',
          details: 'El empleado seleccionado no tiene asignado este servicio. Asigna el servicio al empleado primero o selecciona otro empleado.'
        });
      }
      
      console.log(`[Transfer] ✅ Empleado ${newEmployeeId} tiene el servicio ${serviceId} asignado`);
    } else {
      // El empleado no tiene servicios asignados = es generalista, puede hacer cualquier servicio
      console.log(`[Transfer] ✅ Empleado ${newEmployeeId} es generalista (sin servicios asignados), puede recibir cualquier cita`);
    }
    // ===================================================================================

    // Calculate start and end times (use new time if provided, otherwise keep original)
    let startTime = appt.startTime;
    let endTime = appt.endTime;
    let timeChanged = false;

    if (newStartTime) {
      startTime = new Date(newStartTime);
      endTime = new Date(startTime.getTime() + (appt.Service?.durationMin || 60) * 60000);
      timeChanged = true;
    }

    // Check if new employee is already booked at the target time (skip for express appointments)
    const isExpressAppt = appt.status === 'attention';
    
    if (!isExpressAppt) {
      const conflict = await Appointment.findOne({
        where: {
          employeeId: newEmployeeId,
          id: { [Op.ne]: id }, // Exclude current appointment
          status: { [Op.notIn]: ['cancelled'] },
          startTime: { [Op.lt]: endTime },
          endTime: { [Op.gt]: startTime },
        }
      });

      if (conflict) {
        return res.status(409).json({ 
          error: `El empleado ${newEmployee.User?.name} ya tiene una cita en ese horario`,
          requiresReschedule: true, // Flag to indicate user can pick different time
          conflictAppointment: {
            id: conflict.id,
            startTime: conflict.startTime,
            endTime: conflict.endTime,
          }
        });
      }
    }

    const oldEmployeeName = appt.Employee?.User?.name || 'Empleado anterior';
    const newEmployeeName = newEmployee.User?.name || 'Nuevo empleado';

    // Update appointment with new employee and optionally new time
    await appt.update({ 
      employeeId: newEmployeeId,
      startTime: startTime,
      endTime: endTime
    });

    // Send push notification to new employee
    if (newEmployee.User?.pushToken) {
      await sendPushNotification(newEmployee.User.pushToken, {
        title: '📅 Cita Transferida',
        body: `Se te ha asignado una cita de ${appt.clientName} - ${appt.Service?.name} el ${new Date(appt.startTime).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Bogota' })}`,
      }, {
        type: 'appointment_transferred',
        appointmentId: appt.id,
        businessId: appt.businessId,
        transferredFrom: oldEmployeeName,
      });
    }

    res.json({
      success: true,
      message: `Cita transferida exitosamente de ${oldEmployeeName} a ${newEmployeeName}`,
      appointment: {
        id: appt.id,
        employeeId: newEmployeeId,
        employeeName: newEmployeeName,
        previousEmployeeName: oldEmployeeName,
      }
    });
  } catch (e) {
    console.error('Error transferring appointment:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Obtiene lista de clientes únicos con estadísticas para un negocio
 * Agrupa por teléfono (o email si no hay teléfono)
 */
exports.getClientsByBusiness = async (req, res) => {
  try {
    const businessId = req.query.businessId || req.params.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const { search } = req.query;

    // Obtener todas las citas del negocio con datos de servicio
    const where = { businessId };
    
    // Si hay búsqueda, filtrar por nombre, teléfono o email
    if (search) {
      where[Op.or] = [
        { clientName: { [Op.like]: `%${search}%` } },
        { clientPhone: { [Op.like]: `%${search}%` } },
        { clientEmail: { [Op.like]: `%${search}%` } }
      ];
    }

    const [appointments, tagAssignments, availableTags] = await Promise.all([
      Appointment.findAll({
        where,
        include: [
          { model: Service, attributes: ['id', 'name', 'price'] },
          { model: Employee, include: [{ model: User, attributes: ['name'] }] }
        ],
        order: [['startTime', 'DESC']]
      }),
      ClientTagAssignment.findAll({
        where: { businessId },
        include: [{ model: ClientTag, as: 'Tag', where: { active: true }, required: false }]
      }),
      ClientTag.findAll({
        where: { businessId, active: true },
        attributes: ['id', 'name', 'color']
      })
    ]);

    // Crear mapa de etiquetas por cliente (teléfono/email)
    const tagsByClient = new Map();
    tagAssignments.forEach(assignment => {
      if (!assignment.Tag) return;
      const key = assignment.clientPhone || assignment.clientEmail;
      if (!key) return;
      
      if (!tagsByClient.has(key)) {
        tagsByClient.set(key, []);
      }
      tagsByClient.get(key).push({
        id: assignment.Tag.id,
        name: assignment.Tag.name,
        color: assignment.Tag.color,
        assignmentId: assignment.id
      });
    });

    // Agrupar por cliente (usar teléfono como identificador principal)
    const clientsMap = new Map();

    appointments.forEach(appt => {
      // Usar teléfono como key, si no tiene usar email, si no tiene usar nombre
      const key = appt.clientPhone || appt.clientEmail || appt.clientName || 'Sin contacto';
      
      if (!clientsMap.has(key)) {
        clientsMap.set(key, {
          id: appt.clientId,
          name: appt.clientName || 'Sin nombre',
          phone: appt.clientPhone || null,
          email: appt.clientEmail || null,
          totalAppointments: 0,
          completedAppointments: 0,
          cancelledAppointments: 0,
          totalSpent: 0,
          lastVisit: null,
          firstVisit: null,
          tags: tagsByClient.get(appt.clientPhone) || tagsByClient.get(appt.clientEmail) || [],
          appointments: []
        });
      }

      const client = clientsMap.get(key);
      client.totalAppointments++;
      
      if (appt.status === 'done') {
        client.completedAppointments++;
        client.totalSpent += parseFloat(appt.finalPrice || appt.basePrice || 0);
      } else if (appt.status === 'cancelled') {
        client.cancelledAppointments++;
      }

      const apptDate = new Date(appt.startTime);
      if (!client.lastVisit || apptDate > new Date(client.lastVisit)) {
        client.lastVisit = appt.startTime;
      }
      if (!client.firstVisit || apptDate < new Date(client.firstVisit)) {
        client.firstVisit = appt.startTime;
      }

      client.appointments.push({
        id: appt.id,
        date: appt.startTime,
        service: appt.Service?.name || 'Sin servicio',
        employee: appt.Employee?.User?.name || 'Sin empleado',
        status: appt.status,
        price: appt.finalPrice || appt.basePrice || 0
      });
    });

    const clients = Array.from(clientsMap.values());

    res.json({
      total: clients.length,
      availableTags,
      clients: clients.sort((a, b) => new Date(b.lastVisit) - new Date(a.lastVisit))
    });
  } catch (e) {
    console.error('[getClientsByBusiness] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Obtiene todas las etiquetas de un negocio
 */
exports.getClientTags = async (req, res) => {
  try {
    const businessId = req.query.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const tags = await ClientTag.findAll({
      where: { businessId, active: true },
      order: [['name', 'ASC']]
    });

    res.json(tags);
  } catch (e) {
    console.error('[getClientTags] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Crea una nueva etiqueta
 */
exports.createClientTag = async (req, res) => {
  try {
    const { businessId, name, color, description } = req.body;
    
    if (!businessId || !name) {
      return res.status(400).json({ error: 'businessId y name son requeridos' });
    }

    const tag = await ClientTag.create({
      businessId,
      name: name.trim(),
      color: color || '#667eea',
      description: description || null,
      active: true
    });

    res.status(201).json(tag);
  } catch (e) {
    console.error('[createClientTag] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Actualiza una etiqueta
 */
exports.updateClientTag = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, description } = req.body;

    const tag = await ClientTag.findByPk(id);
    if (!tag) return res.status(404).json({ error: 'Etiqueta no encontrada' });

    await tag.update({
      name: name !== undefined ? name.trim() : tag.name,
      color: color || tag.color,
      description: description !== undefined ? description : tag.description
    });

    res.json(tag);
  } catch (e) {
    console.error('[updateClientTag] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Elimina (desactiva) una etiqueta
 */
exports.deleteClientTag = async (req, res) => {
  try {
    const { id } = req.params;

    const tag = await ClientTag.findByPk(id);
    if (!tag) return res.status(404).json({ error: 'Etiqueta no encontrada' });

    // Desactivar en lugar de eliminar (para mantener historial)
    await tag.update({ active: false });

    // También eliminar todas las asignaciones de esta etiqueta
    await ClientTagAssignment.destroy({
      where: { clientTagId: id }
    });

    res.json({ success: true, message: 'Etiqueta eliminada' });
  } catch (e) {
    console.error('[deleteClientTag] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Asigna una etiqueta a un cliente
 */
exports.assignTagToClient = async (req, res) => {
  try {
    const { businessId, clientTagId, clientPhone, clientEmail, clientName, notes } = req.body;

    if (!businessId || !clientTagId || (!clientPhone && !clientEmail)) {
      return res.status(400).json({ error: 'businessId, clientTagId y clientPhone o clientEmail son requeridos' });
    }

    // Verificar que la etiqueta existe y pertenece al negocio
    const tag = await ClientTag.findOne({
      where: { id: clientTagId, businessId, active: true }
    });
    if (!tag) return res.status(404).json({ error: 'Etiqueta no encontrada' });

    // Verificar si ya existe esta asignación
    const existingAssignment = await ClientTagAssignment.findOne({
      where: {
        businessId,
        clientTagId,
        clientPhone: clientPhone || null,
        clientEmail: clientEmail || null
      }
    });

    if (existingAssignment) {
      return res.status(409).json({ error: 'Esta etiqueta ya está asignada a este cliente' });
    }

    const assignment = await ClientTagAssignment.create({
      businessId,
      clientTagId,
      clientPhone: clientPhone || null,
      clientEmail: clientEmail || null,
      clientName: clientName || null,
      notes: notes || null
    });

    res.status(201).json({
      success: true,
      assignment: {
        ...assignment.toJSON(),
        Tag: tag
      }
    });
  } catch (e) {
    console.error('[assignTagToClient] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Remueve una etiqueta de un cliente
 */
exports.removeTagFromClient = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await ClientTagAssignment.findByPk(assignmentId);
    if (!assignment) return res.status(404).json({ error: 'Asignación no encontrada' });

    await assignment.destroy();

    res.json({ success: true, message: 'Etiqueta removida del cliente' });
  } catch (e) {
    console.error('[removeTagFromClient] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Verificar si una cita puede ser calificada (público)
 */
exports.verifyForRating = async (req, res) => {
  try {
    const { id } = req.params;

    const appointment = await Appointment.findByPk(id, {
      include: [
        { model: Employee, include: [{ model: User, attributes: ['name'] }] },
        { model: Business, attributes: ['name', 'slug'] }
      ]
    });

    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });

    if (appointment.status !== 'done') {
      return res.status(400).json({ error: 'Solo se pueden calificar citas completadas' });
    }

    if (appointment.rating) {
      return res.status(400).json({ error: 'Esta cita ya fue calificada' });
    }

    res.json({
      id: appointment.id,
      employeeName: appointment.Employee?.User?.name || 'Profesional',
      businessName: appointment.Business?.name,
      status: appointment.status,
      canRate: true
    });
  } catch (e) {
    console.error('[verifyForRating] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Calificar empleado después de una cita (cliente - público)
 */
exports.rateAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    // Validar rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'La calificación debe ser entre 1 y 5 estrellas' });
    }

    const appointment = await Appointment.findByPk(id, {
      include: [
        { model: Service, attributes: ['name'] },
        { model: Employee, include: [{ model: User, attributes: ['name', 'email'] }] },
        { model: Business, attributes: ['name'] }
      ]
    });
    if (!appointment) return res.status(404).json({ error: 'Cita no encontrada' });

    // Solo permitir calificar citas completadas
    if (appointment.status !== 'done') {
      return res.status(400).json({ error: 'Solo se pueden calificar citas completadas' });
    }

    // Verificar si ya fue calificada
    if (appointment.rating) {
      return res.status(400).json({ error: 'Esta cita ya fue calificada' });
    }

    // Guardar calificación
    await appointment.update({
      rating: parseInt(rating),
      ratingComment: comment || null,
      ratingSubmittedAt: new Date()
    });

    // Notificar al empleado por email
    try {
      const employeeEmail = appointment.Employee?.User?.email;
      if (employeeEmail) {
        await sendEmail(
          employeeEmail,
          'employeeRated',
          {
            employeeName: appointment.Employee.User.name,
            clientName: appointment.clientName,
            businessName: appointment.Business?.name,
            serviceName: appointment.Service?.name,
            rating: parseInt(rating),
            comment: comment || null,
          }
        );
        console.log(`[rateAppointment] Notificación enviada al empleado ${employeeEmail}`);
      }
    } catch (emailErr) {
      console.error('[rateAppointment] Error enviando notificación al empleado:', emailErr.message);
    }

    res.json({
      success: true,
      message: '¡Gracias por tu calificación!',
      appointment: {
        id: appointment.id,
        rating: parseInt(rating),
        ratingComment: comment
      }
    });
  } catch (e) {
    console.error('[rateAppointment] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Actualizar una cita existente (editar fecha, hora, servicio, etc.)
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { clientName, clientPhone, clientEmail, serviceId, employeeId, startTime, notes } = req.body;

    const appointment = await Appointment.findByPk(id, {
      include: [{ model: Service }]
    });
    
    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // No permitir editar citas completadas o canceladas
    if (['done', 'cancelled'].includes(appointment.status)) {
      return res.status(400).json({ 
        error: `No se puede editar una cita ${appointment.status === 'done' ? 'completada' : 'cancelada'}` 
      });
    }

    const updateData = {};

    // Actualizar datos del cliente
    if (clientName !== undefined) updateData.clientName = clientName;
    if (clientPhone !== undefined) {
      updateData.clientPhone = clientPhone ? clientPhone.replace(/\D/g, '').slice(-10) : null;
    }
    if (clientEmail !== undefined) {
      updateData.clientEmail = clientEmail ? clientEmail.toLowerCase().trim() : null;
    }
    if (notes !== undefined) updateData.notes = notes;

    // Si cambia el servicio, recalcular precio y duración
    if (serviceId && serviceId !== appointment.serviceId) {
      const newService = await Service.findByPk(serviceId);
      if (!newService) {
        return res.status(404).json({ error: 'Servicio no encontrado' });
      }
      
      updateData.serviceId = serviceId;
      updateData.basePrice = parseFloat(newService.price || 0);
      
      // Recalcular precio final con promociones
      const now = new Date();
      const promotion = await Promotion.findOne({
        where: {
          businessId: appointment.businessId,
          active: true,
          startDate: { [Op.lte]: now },
          endDate: { [Op.gte]: now },
          [Op.or]: [
            { serviceId },
            { applyToAllServices: true }
          ]
        },
        order: [['applyToAllServices', 'ASC']]
      });

      let discountApplied = 0;
      if (promotion) {
        if (promotion.discountType === 'percentage') {
          discountApplied = updateData.basePrice * (parseFloat(promotion.discountValue) / 100);
        } else {
          discountApplied = parseFloat(promotion.discountValue);
        }
      }
      
      updateData.finalPrice = Math.max(0, updateData.basePrice - discountApplied);
      
      // Si también cambia la hora, recalcular endTime con la nueva duración
      if (!startTime) {
        const currentStart = new Date(appointment.startTime);
        const newEnd = new Date(currentStart.getTime() + newService.durationMin * 60000);
        updateData.endTime = newEnd;
      }
    }

    // Si cambia el empleado
    if (employeeId && employeeId !== appointment.employeeId) {
      updateData.employeeId = employeeId;
    }

    // Si cambia la fecha/hora
    if (startTime) {
      // Asegurar que la hora se interprete como Colombia (UTC-5) si no viene con zona horaria
      let startTimeWithOffset = startTime;
      if (typeof startTime === 'string' && !startTime.includes('Z') && !startTime.match(/[+-]\d{2}:\d{2}$/)) {
        startTimeWithOffset = startTime + '-05:00'; // Colombia UTC-5
      }
      const newStart = new Date(startTimeWithOffset);
      const serviceDuration = serviceId 
        ? (await Service.findByPk(serviceId))?.durationMin 
        : appointment.Service?.durationMin;
      
      updateData.startTime = newStart;
      updateData.endTime = new Date(newStart.getTime() + serviceDuration * 60000);

      // Verificar conflictos si cambia hora o empleado
      const checkEmployeeId = updateData.employeeId || appointment.employeeId;
      const conflict = await Appointment.findOne({
        where: {
          id: { [Op.ne]: id }, // Excluir la cita actual
          employeeId: checkEmployeeId,
          businessId: appointment.businessId,
          status: { [Op.notIn]: ['cancelled'] },
          startTime: { [Op.lt]: updateData.endTime },
          endTime: { [Op.gt]: updateData.startTime }
        }
      });

      if (conflict) {
        return res.status(409).json({ 
          error: 'El empleado ya tiene una cita en el nuevo horario seleccionado' 
        });
      }
    }

    await appointment.update(updateData);

    // Recargar la cita actualizada con relaciones
    const updatedAppointment = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] }
      ]
    });

    res.json(updatedAppointment);
  } catch (e) {
    console.error('[update] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Extender el tiempo de una cita en curso
 */
exports.extendTime = async (req, res) => {
  try {
    const { id } = req.params;
    const { additionalMinutes } = req.body;

    if (!additionalMinutes || additionalMinutes <= 0) {
      return res.status(400).json({ error: 'Debe especificar minutos adicionales válidos' });
    }

    const appointment = await Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    // Solo permitir extender citas en estado 'attention' (en atención)
    if (appointment.status !== 'attention') {
      return res.status(400).json({ 
        error: 'Solo se puede extender el tiempo de citas que están en atención' 
      });
    }

    // Calcular nuevo endTime
    const currentEndTime = new Date(appointment.endTime);
    const newEndTime = new Date(currentEndTime.getTime() + additionalMinutes * 60000);

    // Verificar que no haya conflicto con otra cita
    const conflict = await Appointment.findOne({
      where: {
        id: { [Op.ne]: id },
        employeeId: appointment.employeeId,
        businessId: appointment.businessId,
        status: { [Op.notIn]: ['cancelled', 'done'] },
        startTime: { [Op.lt]: newEndTime },
        endTime: { [Op.gt]: currentEndTime }
      }
    });

    if (conflict) {
      return res.status(409).json({ 
        error: 'No se puede extender: hay otra cita programada que se solaparía' 
      });
    }

    // Actualizar cita
    const newExtendedDuration = (appointment.extendedDuration || 0) + additionalMinutes;
    await appointment.update({
      endTime: newEndTime,
      extendedDuration: newExtendedDuration
    });

    res.json({
      message: `Tiempo extendido en ${additionalMinutes} minutos`,
      appointment: {
        id: appointment.id,
        endTime: newEndTime,
        extendedDuration: newExtendedDuration,
        newEndTimeFormatted: newEndTime.toLocaleString('es-CO', { 
          dateStyle: 'short', 
          timeStyle: 'short',
          timeZone: 'America/Bogota'
        })
      }
    });
  } catch (e) {
    console.error('[extendTime] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Obtener notas de una cita
 */
exports.getNotes = async (req, res) => {
  try {
    const { id } = req.params;
    
    const appointment = await Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const notes = await AppointmentNote.findAll({
      where: { appointmentId: id },
      order: [['createdAt', 'DESC']]
    });

    res.json(notes);
  } catch (e) {
    console.error('[getNotes] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Agregar una nota a una cita
 */
exports.addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user?.id;
    const userName = req.user?.name;

    if (!content || content.trim() === '') {
      return res.status(400).json({ error: 'El contenido de la nota es requerido' });
    }

    const appointment = await Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const note = await AppointmentNote.create({
      appointmentId: id,
      content: content.trim(),
      authorId: userId,
      authorName: userName || 'Sistema'
    });

    res.status(201).json(note);
  } catch (e) {
    console.error('[addNote] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Eliminar una nota de una cita
 */
exports.deleteNote = async (req, res) => {
  try {
    const { id, noteId } = req.params;

    const note = await AppointmentNote.findOne({
      where: { id: noteId, appointmentId: id }
    });

    if (!note) {
      return res.status(404).json({ error: 'Nota no encontrada' });
    }

    await note.destroy();
    res.json({ message: 'Nota eliminada exitosamente' });
  } catch (e) {
    console.error('[deleteNote] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Actualizar estado del técnico en campo (En Camino, Llegué, En Atención)
 */
exports.updateTechnicianStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    const validStatuses = ['on_the_way', 'arrived', 'in_progress'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado inválido. Use: on_the_way, arrived, in_progress' });
    }

    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['id', 'name', 'pushToken'] }] },
        { model: Business }
      ]
    });

    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });

    // Verificar que el negocio sea de técnicos de campo
    if (!appt.Business?.hasFieldTechnicians) {
      return res.status(400).json({ error: 'Esta función solo está disponible para negocios con técnicos de campo' });
    }

    // Verificar permisos: admin o el empleado asignado
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    const isAssignedEmployee = appt.Employee?.User?.id === userId;

    if (!isAdmin && !isAssignedEmployee) {
      return res.status(403).json({ error: 'No tienes permiso para actualizar esta cita' });
    }

    const updateData = { technicianStatus: status };
    
    // Guardar timestamp según el estado
    if (status === 'on_the_way' && !appt.travelStartTime) {
      updateData.travelStartTime = new Date();
    } else if (status === 'arrived' && !appt.arrivalTime) {
      updateData.arrivalTime = new Date();
    } else if (status === 'in_progress' && !appt.serviceStartTime) {
      updateData.serviceStartTime = new Date();
      updateData.status = 'attention'; // Actualizar estado de la cita
    }

    await appt.update(updateData);

    // Notificar al admin/dueño del cambio de estado
    const owner = await User.findByPk(appt.Business?.ownerId);
    if (owner?.pushToken) {
      const statusLabels = {
        on_the_way: '🚗 En Camino',
        arrived: '📍 Llegó al Destino',
        in_progress: '🔧 Inició el Servicio'
      };
      
      await sendPushNotification(owner.pushToken, {
        title: `Técnico ${statusLabels[status]}`,
        body: `${appt.Employee?.User?.name || 'Técnico'} ${status === 'on_the_way' ? 'va en camino a' : status === 'arrived' ? 'llegó a' : 'inició servicio con'} ${appt.clientName}`,
      }, {
        type: 'technician_status_update',
        appointmentId: appt.id,
        status: status
      });
    }

    res.json({ 
      message: 'Estado actualizado', 
      technicianStatus: status,
      travelStartTime: updateData.travelStartTime || appt.travelStartTime,
      arrivalTime: updateData.arrivalTime || appt.arrivalTime,
      serviceStartTime: updateData.serviceStartTime || appt.serviceStartTime
    });
  } catch (e) {
    console.error('[updateTechnicianStatus] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Guardar reporte técnico con insumos usados
 */
exports.saveTechnicalReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { diagnosis, solution, recommendations, partsUsed } = req.body;
    const userId = req.user.id;

    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['id', 'name'] }] },
        { model: Business }
      ]
    });

    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });

    // Verificar que el negocio sea de técnicos de campo
    if (!appt.Business?.hasFieldTechnicians) {
      return res.status(400).json({ error: 'Esta función solo está disponible para negocios con técnicos de campo' });
    }

    // Verificar permisos
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    const isAssignedEmployee = appt.Employee?.User?.id === userId;

    if (!isAdmin && !isAssignedEmployee) {
      return res.status(403).json({ error: 'No tienes permiso para guardar el reporte' });
    }

    // Guardar reporte
    const workReport = {
      diagnosis: diagnosis || '',
      solution: solution || '',
      recommendations: recommendations || '',
      partsUsed: partsUsed || [],
      savedAt: new Date().toISOString(),
      savedBy: req.user.name || req.user.email
    };

    await appt.update({ workReport });

    // Descontar insumos del inventario si se usaron
    if (partsUsed && partsUsed.length > 0) {
      const { InventoryItem, InventoryUsage } = require('../models');
      
      for (const part of partsUsed) {
        if (part.itemId && part.quantity > 0) {
          const item = await InventoryItem.findOne({
            where: { id: part.itemId, businessId: appt.businessId }
          });

          if (item) {
            // Descontar del stock
            const newStock = parseFloat(item.currentStock) - parseFloat(part.quantity);
            await item.update({ currentStock: Math.max(0, newStock) });

            // Registrar uso en historial
            await InventoryUsage.create({
              businessId: appt.businessId,
              itemId: part.itemId,
              appointmentId: appt.id,
              quantity: part.quantity,
              date: new Date().toISOString().split('T')[0],
              notes: `Usado en servicio - Cita ${appt.id}`,
              usedBy: appt.employeeId
            });
          }
        }
      }
    }

    res.json({ message: 'Reporte técnico guardado exitosamente', workReport });
  } catch (e) {
    console.error('[saveTechnicalReport] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Obtener reporte técnico de una cita
 */
exports.getTechnicalReport = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const appt = await Appointment.findByPk(id, {
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['id', 'name'] }] },
        { model: Business }
      ]
    });

    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });

    // Verificar permisos
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    const isAssignedEmployee = appt.Employee?.User?.id === userId;
    const isOwner = appt.Business?.ownerId === userId;

    if (!isAdmin && !isAssignedEmployee && !isOwner) {
      return res.status(403).json({ error: 'No tienes permiso para ver este reporte' });
    }

    if (!appt.workReport) {
      return res.status(404).json({ error: 'No hay reporte técnico para esta cita' });
    }

    res.json({
      workReport: appt.workReport,
      technicianStatus: appt.technicianStatus,
      travelStartTime: appt.travelStartTime,
      arrivalTime: appt.arrivalTime,
      serviceStartTime: appt.serviceStartTime
    });
  } catch (e) {
    console.error('[getTechnicalReport] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Actualiza los datos de un cliente (nombre, teléfono, email)
 * Actualiza todas las citas que coincidan con el teléfono/email original
 */
exports.updateClient = async (req, res) => {
  try {
    const { businessId } = req.query;
    const { originalPhone, originalEmail, newName, newPhone, newEmail } = req.body;

    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    if (!originalPhone && !originalEmail) {
      return res.status(400).json({ error: 'Debe proporcionar originalPhone o originalEmail para identificar al cliente' });
    }

    // Construir condición de búsqueda para las citas existentes
    const whereCondition = { businessId };
    if (originalPhone) {
      whereCondition.clientPhone = originalPhone;
    }
    if (originalEmail) {
      whereCondition.clientEmail = originalEmail;
    }

    // Verificar que existe al menos una cita con esos datos
    const existingAppointments = await Appointment.findAll({
      where: whereCondition
    });

    if (existingAppointments.length === 0) {
      return res.status(404).json({ error: 'No se encontraron citas con esos datos de cliente' });
    }

    // Preparar datos de actualización
    const updateData = {};
    if (newName !== undefined) updateData.clientName = newName;
    if (newPhone !== undefined) updateData.clientPhone = newPhone;
    if (newEmail !== undefined) updateData.clientEmail = newEmail;

    // Actualizar todas las citas que coincidan
    const [updatedCount] = await Appointment.update(updateData, {
      where: whereCondition
    });

    // Si hay User asociado con ese email/teléfono, también actualizarlo
    if (originalEmail || originalPhone) {
      const userWhere = {};
      if (originalEmail) userWhere.email = originalEmail;
      // Nota: El usuario puede tener teléfono en otra tabla o campo, 
      // pero en este modelo User solo tiene email como identificador único

      const existingUser = await User.findOne({ where: userWhere });
      if (existingUser) {
        const userUpdateData = {};
        if (newName !== undefined) userUpdateData.name = newName;
        if (newEmail !== undefined && newEmail !== originalEmail) {
          // Verificar que el nuevo email no esté en uso
          const emailExists = await User.findOne({ where: { email: newEmail } });
          if (emailExists && emailExists.id !== existingUser.id) {
            return res.status(409).json({ error: 'El nuevo email ya está en uso por otro usuario' });
          }
          userUpdateData.email = newEmail;
        }
        await existingUser.update(userUpdateData);
      }
    }

    res.json({
      message: 'Datos del cliente actualizados correctamente',
      updatedAppointments: updatedCount,
      newData: updateData
    });

  } catch (e) {
    console.error('[updateClient] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Envia email de solicitud de calificación al cliente
 * Se llama automáticamente cuando una cita se marca como "done"
 */
const sendRatingEmail = async (appointment) => {
  try {
    // Determinar el email del cliente
    let clientEmail = null;
    if (appointment.clientId) {
      const clientUser = await User.findByPk(appointment.clientId);
      clientEmail = clientUser?.email || null;
    }
    if (!clientEmail && appointment.clientEmail) {
      clientEmail = appointment.clientEmail;
    }

    if (!clientEmail) {
      console.log('[Rating Email] No se encontró email del cliente para enviar calificación');
      return;
    }

    // Verificar si ya se envió la calificación anteriormente
    if (appointment.ratingEmailSent) {
      console.log(`[Rating Email] Ya se envió calificación anteriormente para cita ${appointment.id}`);
      return;
    }

    const baseUrl = process.env.FRONTEND_URL || 'https://k-dice.com';
    const ratingBaseUrl = `${baseUrl}/rate-employee`;

    await sendEmail(
      clientEmail,
      'serviceCompletedRating',
      {
        clientName: appointment.clientName,
        businessName: appointment.Business?.name || 'Nuestro negocio',
        serviceName: appointment.Service?.name || 'Servicio',
        employeeName: appointment.Employee?.User?.name || 'El técnico',
        ratingBaseUrl,
        appointmentId: appointment.id,
      }
    );

    // Marcar que ya se envió el email de calificación
    await appointment.update({ ratingEmailSent: true, ratingEmailSentAt: new Date() });
    console.log(`[Rating Email] ✅ Enviado a ${clientEmail} para cita ${appointment.id}`);
  } catch (err) {
    console.error('[Rating Email] ❌ Error enviando solicitud de calificación:', err.message);
  }
};
