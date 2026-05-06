/**
 * Acciones principales de citas (crear, actualizar, cancelar)
 */

const { Appointment, Service, Employee, Business, User, AppointmentEmployee, Deposit, Promotion, CashRegisterShift, CashMovement, sequelize } = require('../../models');
const { Op } = require('sequelize');
const { colombiaDateTimeToUTC } = require('./utils');
const { APPOINTMENT_STATUS, MESSAGE_FLOW_STATUS } = require('./constants');
const { emitNewAppointment, emitAppointmentUpdate, emitAppointmentCancelled } = require('../../services/socketService');
const { scheduleMessage } = require('../../services/schedulerService');
const { sendEmail } = require('../../config/email');
const { sendPushNotification } = require('../../services/pushNotificationService');
const { generatePaymentReceipt } = require('../../utils/pdfGenerator');
const { generateAppointmentCreatedMessage } = require('../../services/reminder/message.generators');
const { logActivity } = require('../../utils/activityLogger');


/**
 * Registra automáticamente un movimiento de caja cuando se completa una cita con pago en efectivo
 */
async function registerCashMovementForAppointment(appointment, userId) {
  try {
    // Registrar si el pago es en efectivo o transferencia
    if (!appointment.paymentMethod || !['cash', 'transfer'].includes(appointment.paymentMethod)) {
      console.log(`[Cash Register] Método de pago no válido para registro en caja (${appointment.paymentMethod}), omitiendo registro`);
      return;
    }

    // Si es transferencia, verificar si el negocio incluye transferencias en caja
    if (appointment.paymentMethod === 'transfer') {
      const business = await Business.findByPk(appointment.businessId);
      if (!business || !business.includeTransfersInCashRegister) {
        console.log(`[Cash Register] Negocio no incluye transferencias en caja (${appointment.businessId}), omitiendo registro`);
        return;
      }
    }

    // Buscar turno de caja activo
    const activeShift = await CashRegisterShift.findOne({
      where: {
        businessId: appointment.businessId,
        status: 'open'
      }
    });

    if (!activeShift) {
      console.log(`[Cash Register] No hay turno de caja activo para negocio ${appointment.businessId}`);
      return;
    }

    // Verificar si ya existe un movimiento para esta cita
    const existingMovement = await CashMovement.findOne({
      where: {
        appointmentId: appointment.id
      }
    });

    if (existingMovement) {
      console.log(`[Cash Register] Ya existe movimiento para cita ${appointment.id}`);
      return;
    }

    // Crear movimiento de caja
    const amountToRecord = (appointment.finalPrice !== null && appointment.finalPrice !== undefined) 
      ? appointment.finalPrice 
      : (appointment.Service?.price || 0);

    // Construir descripción incluyendo servicios extra
    let descriptionText = `Pago de cita: ${appointment.Service?.name || 'Servicio'}`;
    
    if (appointment.extraServices && Array.isArray(appointment.extraServices) && appointment.extraServices.length > 0) {
      const extrasText = appointment.extraServices.map(s => s.name).join(', ');
      descriptionText += ` (+ ${extrasText})`;
    }

    if (appointment.discountApplied && parseFloat(appointment.discountApplied) > 0) {
      descriptionText += ` (Desc: -$${parseFloat(appointment.discountApplied).toLocaleString()})`;
    }
    
    descriptionText += ` - ${appointment.clientName}`;

    await CashMovement.create({
      businessId: appointment.businessId,
      shiftId: activeShift.id,
      appointmentId: appointment.id,
      type: 'income',
      amount: amountToRecord,
      paymentMethod: appointment.paymentMethod,
      description: descriptionText,
      createdBy: userId
    });

    console.log(`[Cash Register] Movimiento registrado para cita ${appointment.id}: $${amountToRecord}`);
  } catch (error) {
    console.error('[Cash Register] Error registrando movimiento de caja:', error.message);
    // No lanzar error para no interrumpir el flujo principal
  }
}

/**
 * Reversa un movimiento de caja asociado a una cita (cuando se anula o cambia de estado)
 */
async function reverseCashMovementForAppointment(appointmentId, userId) {
  try {
    const movement = await CashMovement.findOne({
      where: {
        appointmentId,
        isReversal: false
      }
    });

    if (!movement) return;

    // Verificar si ya tiene una reversa activa
    const existingReversal = await CashMovement.findOne({
      where: {
        reversesMovementId: movement.id,
        isReversal: true
      }
    });

    if (existingReversal) {
      console.log(`[Cash Register] El movimiento para la cita ${appointmentId} ya fue reversado anteriormente.`);
      return;
    }

    // Buscar turno de caja activo para el negocio
    const activeShift = await CashRegisterShift.findOne({
      where: {
        businessId: movement.businessId,
        status: 'open'
      }
    });

    if (!activeShift) {
      console.log(`[Cash Register] No hay turno abierto para reversar el movimiento de la cita ${appointmentId}`);
      return;
    }

    // Crear el movimiento de reversa (tipo opuesto)
    const reversalType = movement.type === 'income' ? 'expense' : 'income';

    await CashMovement.create({
      businessId: movement.businessId,
      shiftId: activeShift.id, // Se registra en el turno actual
      type: reversalType,
      amount: movement.amount,
      paymentMethod: movement.paymentMethod,
      description: `REVERSA: Cita #${appointmentId.slice(0, 8)} - Cambio de estado / Anulación`,
      notes: `Reversa automática por cambio de estado desde el sistema. ID Original: ${movement.id}`,
      isReversal: true,
      reversesMovementId: movement.id,
      appointmentId: appointmentId,
      createdBy: userId
    });

    console.log(`[Cash Register] ✅ Reversa exitosa para cita ${appointmentId} en el turno ${activeShift.id}`);
  } catch (error) {
    console.error('[Cash Register] Error reversando movimiento:', error.message);
  }
}

/**
 * Crea una nueva cita
 */
async function createAppointment(data, user) {
  const {
    businessId, serviceId, employeeId, clientName, clientPhone, clientEmail, address,
    startTime, notes, status, additionalEmployeeIds = [], depositAmount, depositAccepted,
    extraServices = []
  } = data;

  console.log('[Create Appointment] Datos recibidos:', {
    businessId, serviceId, employeeId, startTime, clientEmail, clientName, clientPhone, user: user?.id || 'no auth'
  });

  if (!serviceId) {
    throw new Error('serviceId es requerido');
  }

  const service = await Service.findByPk(serviceId);
  if (!service) {
    console.error('[Create Appointment] Service not found:', serviceId);
    throw new Error('Servicio no encontrado: ' + serviceId);
  }
  console.log('[Create Appointment] Service found:', service.name, 'duration:', service.durationMin);

  // ========== VALIDACIÓN: El empleado debe tener el servicio asignado (o ser generalista) ==========
  if (employeeId) {
    const { EmployeeService } = require('../../models');

    // Verificar que el empleado existe y está activo
    const employee = await Employee.findOne({
      where: { id: employeeId, businessId, active: true }
    });

    if (!employee) {
      throw new Error('Empleado no encontrado o inactivo');
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
        throw new Error('Este empleado no puede realizar el servicio seleccionado');
      }

      console.log(`[Create Appointment] ✅ Empleado ${employeeId} tiene el servicio ${serviceId} asignado`);
    } else {
      // El empleado no tiene servicios asignados = es generalista, puede hacer cualquier servicio
      console.log(`[Create Appointment] ✅ Empleado ${employeeId} es generalista (sin servicios asignados), puede hacer cualquier servicio`);
    }
  }
  // =============================================================================

  const business = await Business.findByPk(businessId);
  if (!business) throw new Error('Negocio no encontrado');

  // Validar dirección para negocios con técnicos a domicilio
  if (business.hasFieldTechnicians && !address) {
    throw new Error('La dirección es requerida para servicios a domicilio');
  }

  // Asegurar que la hora se interprete como Colombia (UTC-5) si no viene con zona horaria
  let startTimeWithOffset = startTime;
  if (typeof startTime === 'string' && !startTime.includes('Z') && !startTime.match(/[+-]\d{2}:\d{2}$/)) {
    startTimeWithOffset = startTime + '-05:00'; // Colombia UTC-5
  }
  const start = new Date(startTimeWithOffset);
  
  // Calcular duración total (Principal + Extras)
  const mainDuration = parseInt(service.durationMin || 0);
  const extrasDuration = (extraServices || []).reduce((sum, s) => sum + (parseInt(s.durationMin) || 0), 0);
  const totalDuration = mainDuration + extrasDuration;

  const end = new Date(start.getTime() + totalDuration * 60000);
  console.log('[Create Appointment] Checking conflict:', { employeeId, start: start.toISOString(), end: end.toISOString(), originalStartTime: startTime });

  // Validar que la hora no sea en el pasado (con margen de 5 minutos)
  // Las citas express (status='attention') están exentas de esta validación
  const isExpress = status === 'attention';
  if (!isExpress) {
    const now = new Date();
    const MARGIN_MS = 5 * 60 * 1000; // 5 minutos de margen
    if (start.getTime() < (now.getTime() - MARGIN_MS)) {
      throw new Error('No se pueden crear citas para horas en el pasado');
    }
  }

  // Verificar conflictos SOLO si no es cita express (status='attention')
  // Las citas express son para atención inmediata y no deben ser bloqueadas

  if (!isExpress) {
    const conflict = await Appointment.findOne({
      where: {
        employeeId,
        businessId,
        status: { [Op.notIn]: ['cancelled'] },
        startTime: { [Op.lt]: new Date(end.getTime() - 10000) }, // Margen de 10 seg
        endTime: { [Op.gt]: new Date(start.getTime() + 10000) }, // Margen de 10 seg
      }
    });
    if (conflict) throw new Error('El empleado ya tiene una cita en ese horario');
  }

  // CALCULAR PRECIO CON PROMOCIONES Y SERVICIOS EXTRA
  const today = new Date().toISOString().split('T')[0];
  const promotion = await Promotion.findOne({
    where: {
      businessId,
      active: true,
      startDate: { [Op.lte]: today },
      endDate: { [Op.gte]: today },
      [Op.or]: [
        { serviceId },
        { applyToAllServices: true }
      ]
    },
    order: [['applyToAllServices', 'ASC']] // Priorizar promociones específicas sobre las generales
  });

  const mainPrice = parseFloat(service.price || 0);
  const extrasPrice = (extraServices || []).reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
  const basePrice = mainPrice + extrasPrice;
  
  let discountApplied = 0;
  let promotionId = null;

  if (promotion) {
    promotionId = promotion.id;
    if (promotion.discountType === 'percentage') {
      discountApplied = mainPrice * (parseFloat(promotion.discountValue) / 100);
    } else {
      discountApplied = parseFloat(promotion.discountValue);
    }
  }

  const finalPrice = Math.max(0, basePrice - discountApplied);

  const cleanPhone = clientPhone ? clientPhone.replace(/\D/g, '').slice(-10) : null;

  // Verificar que los empleados adicionales existan y estén activos
  const additionalEmployees = additionalEmployeeIds || [];
  if (additionalEmployees.length > 0) {
    for (const addEmpId of additionalEmployees) {
      const addEmp = await Employee.findOne({
        where: { id: addEmpId, businessId, active: true }
      });
      if (!addEmp) {
        throw new Error(`Empleado adicional no encontrado o inactivo: ${addEmpId}`);
      }

      // Verificar que no sea el mismo empleado principal
      if (addEmpId === employeeId) {
        throw new Error('No puede agregar el empleado principal como adicional');
      }

      // Verificar que el empleado adicional no tenga conflicto de horario
      const addEmpConflict = await Appointment.findOne({
        where: {
          employeeId: addEmpId,
          businessId,
          status: { [Op.notIn]: ['cancelled'] },
          startTime: { [Op.lt]: new Date(end.getTime() - 10000) },
          endTime: { [Op.gt]: new Date(start.getTime() + 10000) },
        }
      });
      if (addEmpConflict && !isExpress) {
        throw new Error('El empleado adicional ya tiene una cita en ese horario');
      }
    }
  }

  // Generar código de referencia único
  const referenceCode = generateReferenceCode();

  // Crear la cita
  const appointmentData = {
    businessId,
    serviceId,
    employeeId,
    clientName: clientName.trim(),
    clientPhone: cleanPhone,
    clientEmail: clientEmail ? clientEmail.toLowerCase().trim() : null,
    address: address ? address.trim() : null,
    clientId: (user && user.role === 'client') ? user.id : (data.clientId || null),
    startTime: start,
    endTime: end,
    notes: notes || null,
    status: status || APPOINTMENT_STATUS.PENDING,
    referenceCode,
    messageFlowStatus: MESSAGE_FLOW_STATUS.NOT_STARTED,
    confirmed: false,
    createdBy: user?.id || null,
    basePrice,
    discountApplied,
    finalPrice,
    promotionId,
    extraServices: extraServices || [],
    source: data.source || 'web'
  };

  const appointment = await Appointment.create(appointmentData);

  // Registrar actividad
  if (user) {
    logActivity({ user }, {
      action: 'CREATE_APPOINTMENT',
      entityType: 'Appointment',
      entityId: appointment.id,
      businessId: businessId,
      description: `Nueva cita creada para ${clientName} (${service.name})`,
      newValues: { startTime: start, serviceId, employeeId }
    });
  }


  // Agregar empleados adicionales si los hay
  if (additionalEmployees.length > 0) {
    const appointmentEmployees = additionalEmployees.map((addEmpId, index) => ({
      appointmentId: appointment.id,
      employeeId: addEmpId,
      role: index === 0 ? 'auxiliar' : 'apoyo'
    }));
    await AppointmentEmployee.bulkCreate(appointmentEmployees);
    console.log('[Create Appointment] Empleados adicionales agregados:', additionalEmployees.length);
  }

  // Crear depósito si aplica
  if (depositAccepted && depositAmount > 0) {
    try {
      await Deposit.create({
        businessId,
        appointmentId: appointment.id,
        clientName,
        clientPhone: cleanPhone,
        amount: parseFloat(depositAmount),
        date: new Date().toISOString().split('T')[0],
        paymentMethod: 'cash',
        status: 'held',
        notes: `Anticipo generado automáticamente al crear cita. Pendiente de pago.`,
        createdBy: user?.id
      });
      console.log('[Create Appointment] Depósito creado automáticamente:', depositAmount);
    } catch (depositError) {
      console.error('[Create Appointment] Error creando depósito:', depositError);
      // No fallar la creación de cita si el depósito falla
    }
  }

  console.log('[Create Appointment] Cita creada exitosamente:', {
    id: appointment.id,
    businessId: appointment.businessId,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
    additionalEmployees: additionalEmployees.length
  });

  // Recargar con relaciones
  const result = await Appointment.findByPk(appointment.id, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
      { model: Business },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] }] }
    ]
  });

  // Notificaciones automáticas (sin bloquear la respuesta)
  console.log('[Create Appointment] Iniciando notificaciones en setImmediate...');
  setImmediate(async () => {
    console.log('[Create Appointment] Ejecutando notificaciones...');
    try {
      const fullAppt = result;
      console.log('[Create Appointment] Cita encontrada:', !!fullAppt);
      if (!fullAppt) {
        console.log('[Create Appointment] ERROR: No se encontró la cita');
        return;
      }

      // Emitir SOCKET PRIMERO - No bloquear por emails
      console.log('[Create Appointment] === EMITIENDO SOCKET INMEDIATAMENTE ===');
      try {
        console.log(`[Socket] Preparando emitir cita ${appointment.id}:`, {
          businessId: fullAppt.businessId,
          employeeId: fullAppt.employeeId
        });

        await emitNewAppointment(fullAppt.toJSON(), {
          notifyEmployee: true,
          notifyAdmin: true
        });
        console.log(`[Socket] ✅ Cita ${appointment.id} emitida en tiempo real`);
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
          clientName: String(fullAppt.clientName || ''),
          serviceName: String(fullAppt.Service?.name || ''),
          employeeName: String(fullAppt.Employee?.User?.name || ''),
          startTime: String(fullAppt.startTime || ''),
        }).catch(e => console.error('[Email] Admin notify error:', e.message));
      }

      // Enviar push notification al dueño (async)
      console.log('[Create Appointment] Verificando pushToken del dueño:', owner?.pushToken ? 'EXISTS' : 'NULL');
      if (owner?.pushToken) {
        const startTimeStr = new Date(fullAppt.startTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
        console.log('[Create Appointment] Enviando push al dueño:', owner.name);
        sendPushNotification(owner.pushToken, {
          title: '📅 Nueva Cita Agendada',
          body: `${fullAppt.clientName || 'Cliente'} agendó ${fullAppt.Service?.name || 'servicio'} a las ${startTimeStr}`,
        }, {
          type: 'new_appointment',
          appointmentId: fullAppt.id,
          businessName: String(fullAppt.Business?.name || ''),
        }).then(result => console.log('[Create Appointment] Push enviado al dueño:', result))
          .catch(e => console.error('[Push] Owner notify error:', e.message));
      }

      // Enviar push al empleado asignado (async)
      console.log('[Create Appointment] Verificando pushToken del empleado:', fullAppt.Employee?.User?.pushToken ? 'EXISTS' : 'NULL');
      if (fullAppt.Employee?.User?.pushToken) {
        const startTimeStr = new Date(fullAppt.startTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
        console.log('[Create Appointment] Enviando push al empleado:', fullAppt.Employee.User.name);
        sendPushNotification(fullAppt.Employee.User.pushToken, {
          title: '📅 Nueva Cita Asignada',
          body: `Tienes una cita con ${fullAppt.clientName || 'Cliente'} (${fullAppt.Service?.name || 'Servicio'}) a las ${startTimeStr}`,
        }, {
          type: 'new_appointment',
          appointmentId: fullAppt.id,
          employeeId: fullAppt.employeeId,
        }).then(result => console.log('[Create Appointment] Push enviado al empleado:', result))
          .catch(e => console.error('[Push] Employee notify error:', e.message));
      }

      // Email al cliente (async)
      let clientEmailTo = fullAppt.clientEmail;
      if (appointment.clientId && !clientEmailTo) {
        const clientUser = await User.findByPk(appointment.clientId);
        clientEmailTo = clientUser?.email || null;
      }
      if (clientEmailTo) {
        console.log('[Create Appointment] Enviando email al cliente (async)...');
        sendEmail(clientEmailTo, 'appointmentConfirmation', {
          clientName: String(fullAppt.clientName || ''),
          businessName: String(fullAppt.Business?.name || ''),
          serviceName: String(fullAppt.Service?.name || ''),
          employeeName: String(fullAppt.Employee?.User?.name || ''),
          startTime: String(fullAppt.startTime || ''),
          price: String(fullAppt.finalPrice || fullAppt.Service?.price || ''),
        }).catch(e => console.error('[Email] Client notify error:', e.message));
      }

      // WhatsApp al cliente - Mensaje de confirmación 1 minuto después de crear la cita
      // Solo si tiene teléfono, no es negocio de técnicos de campo, y NO es cita express (walk-in)
      const isExpressAppointment = fullAppt.status === 'attention';
      if (fullAppt.clientPhone && !fullAppt.Business?.hasFieldTechnicians && !isExpressAppointment) {
        // Delay adaptativo: 5 minutos para chatbot (para parecer más humano/procesamiento), 1 minuto para otros
        const delayMinutes = fullAppt.source === 'kady_chatbot' ? 5 : 1;
        console.log(`[Create Appointment] Programando mensaje de WhatsApp ${delayMinutes} min después... (Source: ${fullAppt.source || 'default'})`);
        
        try {
          const messageText = generateAppointmentCreatedMessage(fullAppt);
          await scheduleMessage({
            businessId: fullAppt.businessId,
            appointmentId: fullAppt.id,
            phone: fullAppt.clientPhone,
            message: messageText,
            type: 'custom',
            scheduledAt: new Date(Date.now() + delayMinutes * 60 * 1000)
          });
          console.log(`[Create Appointment] ✅ Mensaje de cita creada programado para ${delayMinutes} minutos después`);
        } catch (waErr) {
          console.error('[Create Appointment] Error programando mensaje WhatsApp:', waErr.message);
        }
      } else if (isExpressAppointment) {
        console.log('[Create Appointment] ℹ️ Cita express (walk-in): No se envía mensaje de confirmación, solo se enviará calificación al finalizar');
      }

      console.log('[Create Appointment] ✅ Notificaciones iniciadas (socket ya emitido)');
    } catch (e) {
      console.error('[Create Appointment] ❌ ERROR en notificaciones:', e.message, e.stack);
    }
  });

  return result;
}

/**
 * Genera un código de referencia único de 6 caracteres
 */
function generateReferenceCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Actualiza el estado de una cita
 */
async function updateAppointmentStatus(appointmentId, newStatus, user, options = {}) {
  // Manejar compatibilidad si options es solo paymentMethod (string)
  const opt = typeof options === 'string' ? { paymentMethod: options } : options;
  const { paymentMethod, discountApplied, finalPrice, additionalAmount, additionalNote } = opt;

  const appointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: Business, attributes: ['id', 'name', 'whatsapp'] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ]
  });

  if (!appointment) throw new Error('Cita no encontrada');

  const oldStatus = appointment.status;
  const now = new Date();

  // Si el estado anterior era DONE y el nuevo NO lo es, reversar movimiento en caja
  if (oldStatus === APPOINTMENT_STATUS.DONE && newStatus !== APPOINTMENT_STATUS.DONE) {
    await reverseCashMovementForAppointment(appointment.id, user?.id);
  }

  // Actualizar según el nuevo estado
  const updateData = { status: newStatus };

  switch (newStatus) {
    case APPOINTMENT_STATUS.CONFIRMED:
      updateData.confirmed = true;
      updateData.confirmedAt = now;
      break;
    case APPOINTMENT_STATUS.ATTENTION:
      // Si viene de confirmed/pending, marcar que ya atendieron
      break;
    case APPOINTMENT_STATUS.DONE:
      // Si vienen valores explícitos desde el modal de completar, usarlos
      if (discountApplied !== undefined) updateData.discountApplied = parseFloat(discountApplied);
      if (finalPrice !== undefined) updateData.finalPrice = parseFloat(finalPrice);
      if (additionalAmount !== undefined) updateData.additionalAmount = parseFloat(additionalAmount);
      if (additionalNote !== undefined) updateData.additionalNote = additionalNote;

      // Calcular precio final si no viene explícitamente y no está guardado
      if (updateData.finalPrice === undefined && !appointment.finalPrice) {
        const basePrice = parseFloat(appointment.basePrice || appointment.Service?.price || 0);
        
        // Sumar servicios extra guardados en la cita
        const extraServices = updateData.extraServices || appointment.extraServices || [];
        const extrasAmount = extraServices.reduce((sum, s) => sum + (parseFloat(s.price) || 0), 0);
        
        // Sumar cargos adicionales antiguos
        const additionalCharges = appointment.additionalCharges || [];
        const additionalAmountSum = additionalCharges.reduce((sum, charge) => sum + parseFloat(charge.amount || 0), 0);
        
        // Monto adicional directo
        const directAdditional = parseFloat(updateData.additionalAmount || appointment.additionalAmount || 0);
        
        const discount = parseFloat(updateData.discountApplied !== undefined ? updateData.discountApplied : (appointment.discountApplied || 0));
        
        const calculatedFinalPrice = basePrice + extrasAmount + additionalAmountSum + directAdditional - discount;
        updateData.finalPrice = Math.max(0, calculatedFinalPrice);
        
        console.log(`[updateAppointmentStatus] Calculated finalPrice for appointment ${appointment.id}: ${updateData.finalPrice}`);
      }

      // Guardar método de pago si se proporcionó
      const finalPaymentMethod = paymentMethod || appointment.paymentMethod;
      if (finalPaymentMethod && ['cash', 'transfer'].includes(finalPaymentMethod)) {
        updateData.paymentMethod = finalPaymentMethod;
        console.log(`[updateAppointmentStatus] Payment method saved: ${finalPaymentMethod}`);
      }

      // Registrar movimiento en caja si es pago en efectivo o transferencia (SIN DELAY)
      if (updateData.paymentMethod === 'cash' || updateData.paymentMethod === 'transfer') {
        try {
          // Usar los datos que ya tenemos para asegurar consistencia
          const currentAppt = await Appointment.findByPk(appointmentId, { include: [{ model: Service }] });
          // Fusionar los cambios pendientes para el registro en caja
          const apptForRegister = { 
            ...currentAppt.toJSON(), 
            ...updateData,
            Service: currentAppt.Service 
          };
          await registerCashMovementForAppointment(apptForRegister, user?.id);
          console.log(`[Cash Register] Registro inmediato exitoso para cita ${appointmentId}`);
        } catch (err) {
          console.error('[Cash Register] Error en registro inmediato:', err.message);
        }
      }

      // Enviar comprobante de pago y solicitud de calificación (en background)
      if (oldStatus !== 'done') {
        setImmediate(() => {
          setTimeout(async () => {
            try {
              console.log(`[Done Action] Iniciando procesamiento post-completado para cita ${appointment.id}`);

              // Recargar cita para asegurar datos frescos
              const freshAppt = await Appointment.findByPk(appointment.id, {
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

              // 1. Decidir si enviamos comprobante de pago (PDF)
              // NO se envía PDF si es técnico general o técnico de campo
              const isAnyTechnical = freshAppt.Business?.isTechnicalServices || freshAppt.Business?.hasFieldTechnicians || false;
              if (!isAnyTechnical) {
                try {
                  await sendPaymentReceipt(freshAppt);
                  console.log(`[Done Action] Comprobante enviado para cita ${appointment.id}`);
                } catch (receiptErr) {
                  console.error('[Done Action] Error enviando comprobante:', receiptErr.message);
                }
              } else {
                console.log(`[Done Action] Negocio técnico - omitiendo envío de comprobante PDF para cita ${appointment.id}`);
              }
 
              // 2. Decidir si enviamos calificación por EMAIL
              // SOLO se envía por email si es técnico de campo (porque ellos no tienen WhatsApp)
              // Los técnicos especializados NO la reciben por email porque ya la reciben por WhatsApp
              const isFieldTechnical = freshAppt.Business?.hasFieldTechnicians || false;
              if (isFieldTechnical) {
                try {
                  await sendRatingEmail(freshAppt);
                  console.log(`[Done Action] Solicitud de calificación por email enviada (Técnico de Campo) para cita ${appointment.id}`);
                } catch (ratingEmailErr) {
                  console.error('[Done Action] Error enviando solicitud de calificación por email:', ratingEmailErr.message);
                }
              }

              // 3. Enviar solicitud de calificación por WhatsApp
              // Se envía a todos EXCEPTO a los técnicos de campo (porque ellos no tienen WhatsApp configurado)
              if (!isFieldTechnical && freshAppt.clientPhone && !freshAppt.ratingSent) {
                try {
                  const { WhatsAppSession, Business } = require('../../models');
                  const { Op } = require('sequelize');
                  const { queueMessage, getRandomRatingTemplate, hasValidSession } = require('../../services/evolutionService');

                  const resolvedBizId = await Business.resolveWhatsAppBusinessId(freshAppt.businessId);
                  // Buscar sesión tanto con el ID resuelto (padre) como con el ID directo de la sucursal
                  let session = await WhatsAppSession.findOne({
                    where: {
                      businessId: { [Op.in]: [resolvedBizId, freshAppt.businessId] },
                      status: { [Op.in]: ['connected', 'session_saved'] }
                    }
                  });

                  // Si no hay sesión en BD, verificar directamente con Evolution API
                  if (!session) {
                    console.log(`[Done Action] ℹ️ No se encontró sesión en BD para ${freshAppt.businessId}, verificando con Evolution API...`);
                    const hasValidWhatsApp = await hasValidSession(freshAppt.businessId) || await hasValidSession(resolvedBizId);
                    if (hasValidWhatsApp) {
                      console.log(`[Done Action] ✅ WhatsApp está conectado según Evolution API`);
                      // Crear una sesión temporal para permitir el envío
                      session = { businessId: freshAppt.businessId, status: 'connected' };
                    }
                  }

                  if (session) {
                    const employeeName = freshAppt.Employee?.User?.name || 'nuestro profesional';
                    const businessName = freshAppt.Business?.name || 'nosotros';
                    const businessSlug = freshAppt.Business?.slug || freshAppt.businessId;
                    const ratingTemplate = getRandomRatingTemplate();

                    const baseUrl = process.env.FRONTEND_URL || 'https://k-dice.com';
                    const reviewLink = `${baseUrl}/${businessSlug}?review=true`;

                    const serviceDate = new Date(freshAppt.startTime).toLocaleDateString('es-CO', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long'
                    });
                    const ratingText = `¡Hola *${freshAppt.clientName}*! 👋\n\nGracias por tu visita el *${serviceDate}* a *${businessName}*.\n\n${ratingTemplate}\n\n💇 Servicio con: *${employeeName}*\n\nResponde con un número del *1 al 5* ⭐`;
                    console.log(`[Done Action] Programando calificación para cita ${freshAppt.id} (${serviceDate} - ${employeeName})`);

                    const reviewText = `¡Hola *${freshAppt.clientName}*! 👋\n\n¿Quieres ayudar a *${businessName}* a crecer?\n\n💬 Deja una reseña pública y ayuda a otros clientes a conocernos:\n👉 ${reviewLink}\n\n¡Gracias por tu confianza! ❤️`;

                    // Programar calificación del empleado a los 5 minutos
                    await scheduleMessage({
                      businessId: freshAppt.businessId,
                      appointmentId: freshAppt.id,
                      phone: freshAppt.clientPhone,
                      message: ratingText,
                      type: 'rating',
                      scheduledAt: new Date(Date.now() + 5 * 60 * 1000)
                    });

                    await freshAppt.update({
                      ratingSent: true,
                      ratingSentAt: new Date(),
                      messageFlowStatus: 'awaiting_rating'
                    });
                    console.log(`[Done Action] Cita ${freshAppt.id} marcada como awaiting_rating`);

                    // Programar solicitud de reseña del negocio a las 2 horas
                    await scheduleMessage({
                      businessId: freshAppt.businessId,
                      appointmentId: freshAppt.id,
                      phone: freshAppt.clientPhone,
                      message: reviewText,
                      type: 'review',
                      scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
                    });

                    console.log(`[Done Action] Mensajes programados en BD: Calificación (5min) + Reseña (2h) para cita ${appointment.id}`);
                  } else {
                    console.log(`[Done Action] ℹ️ No se programa calificación: WhatsApp no configurado o no conectado para el negocio ${freshAppt.businessId} (verificado en BD y Evolution API)`);
                  }
                } catch (waErr) {
                  console.error('[Done Action] Error programando solicitud de calificación:', waErr.message);
                }
              }

              console.log(`[Done Action] Procesamiento completado para cita ${appointment.id}`);
            } catch (e) {
              console.error('[Done Action] Error general:', e.message);
            }
          }, 5000);
        });
      }
      break;
    case APPOINTMENT_STATUS.CANCELLED:
      updateData.cancelledAt = now;
      updateData.cancelledBy = user?.id || null;
      break;
    case APPOINTMENT_STATUS.NO_SHOW:
      break;
  }

  await appointment.update(updateData);

  // Registrar actividad
  if (user) {
    logActivity({ user }, {
      action: 'UPDATE_APPOINTMENT_STATUS',
      entityType: 'Appointment',
      entityId: appointmentId,
      businessId: appointment.businessId,
      description: `Estado de cita cambiado de ${oldStatus} a ${newStatus}`,
      oldValues: { status: oldStatus },
      newValues: { status: newStatus },
      metadata: { paymentMethod }
    });
  }


  // Recargar con todas las relaciones para emitir actualización completa
  const updatedAppointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: Business, attributes: ['id', 'name', 'whatsapp'] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ]
  });

  // Emitir actualización
  const apptData = updatedAppointment.toJSON();
  console.log(`[updateAppointmentStatus] Emitiendo actualización para cita ${appointmentId}:`, {
    status: apptData.status,
    employeeId: apptData.employeeId,
    businessId: apptData.businessId,
    startTime: apptData.startTime
  });
  emitAppointmentUpdate(apptData);
  console.log(`[updateAppointmentStatus] Evento emitido exitosamente`);

  return updatedAppointment;
}

/**
 * Programa mensaje de calificación
 */
async function scheduleRatingMessage(appointment) {
  const ratingTime = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos después
  const phone = appointment.clientPhone;
  
  if (!phone) {
    console.log(`[Rating] No hay teléfono para cita ${appointment.id}, saltando mensaje`);
    return;
  }

  const message = `¡Hola *${appointment.clientName}*! 👋\n\nGracias por tu visita el *${formatDateColombia(appointment.startTime)}* a *${appointment.Business?.name || 'nuestro negocio'}*.\n\n⭐ ¿Cómo fue tu experiencia? Responde con una calificación del 1 al 5. ¡Tu opinión nos ayuda!`;

  await scheduleMessage({
    businessId: appointment.businessId,
    appointmentId: appointment.id,
    phone: phone,
    message: message,
    type: 'rating',
    scheduledAt: ratingTime
  });

  await appointment.update({
    ratingSent: true,
    ratingSentAt: ratingTime,
    messageFlowStatus: MESSAGE_FLOW_STATUS.AWAITING_RATING
  });

  console.log(`[Rating] Mensaje programado para cita ${appointment.id} a las ${ratingTime}`);
}

/**
 * Cancela una cita
 */
async function cancelAppointment(appointmentId, reason, user) {
  const appointment = await Appointment.findByPk(appointmentId, {
    include: [{ model: Business, attributes: ['id', 'name'] }]
  });

  if (!appointment) throw new Error('Cita no encontrada');

  await appointment.update({
    status: APPOINTMENT_STATUS.CANCELLED,
    cancelledAt: new Date(),
    cancelledBy: user?.id || null,
    cancellationReason: reason || null,
    messageFlowStatus: MESSAGE_FLOW_STATUS.COMPLETED
  });

  // Emitir cancelación
  emitAppointmentCancelled(appointment.toJSON(), user?.id);

  return appointment;
}

/**
 * Actualiza datos de una cita
 */
async function updateAppointment(appointmentId, data) {
  const {
    clientName, clientPhone, clientEmail, serviceId, employeeId, startTime, notes
  } = data;

  const appointment = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] }
    ]
  });

  if (!appointment) throw new Error('Cita no encontrada');

  const updateData = {};

  if (clientName) updateData.clientName = clientName.trim();
  if (clientPhone) updateData.clientPhone = clientPhone.replace(/\D/g, '');
  if (clientEmail) updateData.clientEmail = clientEmail.toLowerCase().trim();
  if (notes !== undefined) updateData.notes = notes;

  if (serviceId && serviceId !== appointment.serviceId) {
    const service = await Service.findByPk(serviceId);
    if (!service) throw new Error('Servicio no encontrado');
    updateData.serviceId = serviceId;

    // Recalcular endTime si cambió el servicio
    const durationMin = service.durationMin || service.duration || 30;
    if (startTime) {
      const start = new Date(startTime);
      updateData.startTime = start;
      updateData.endTime = new Date(start.getTime() + durationMin * 60000);
    } else {
      const currentStart = new Date(appointment.startTime);
      updateData.endTime = new Date(currentStart.getTime() + durationMin * 60000);
    }
  }

  if (employeeId) updateData.employeeId = employeeId;

  if (startTime && !updateData.startTime) {
    const parsedStartTime = new Date(startTime);
    // Only update if startTime is a valid date
    if (!isNaN(parsedStartTime.getTime())) {
      const service = await Service.findByPk(updateData.serviceId || appointment.serviceId);
      const durationMin = service?.durationMin || service?.duration || 30;
      updateData.startTime = parsedStartTime;
      updateData.endTime = new Date(parsedStartTime.getTime() + durationMin * 60000);
    }
  }

  await appointment.update(updateData);

  // Recargar con relaciones
  const result = await Appointment.findByPk(appointmentId, {
    include: [
      { model: Service },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ]
  });

  emitAppointmentUpdate(result.toJSON());

  return result;
}

// Import utils for formatting
const { formatDateColombia } = require('./utils');

/**
 * Función auxiliar para enviar comprobante de pago o orden de servicio
 */
async function sendPaymentReceipt(appointment) {
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
    console.log('[Email] No se encontró email del cliente para enviar comprobante');
    return;
  }

  const isTechnicalService = appointment.Business?.isTechnicalServices || appointment.Business?.hasFieldTechnicians || false;
  const orderNumber = appointment.id.substring(0, 8).toUpperCase();

  const basePrice = parseFloat(appointment.basePrice || appointment.Service?.price || 0);
  // Calcular total de cargos adicionales desde el array
  const additionalCharges = appointment.additionalCharges || [];
  const additional = additionalCharges.reduce((sum, charge) => sum + parseFloat(charge.amount || 0), 0);
  const totalPrice = basePrice + additional;

  // Generar PDF
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
    price: basePrice,
    additionalAmount: additional,
    additionalNote: appointment.additionalNote,
    paymentMethod: appointment.paymentMethod || 'Efectivo',
    notes: appointment.notes,
    isTechnicalService: isTechnicalService,
    clientSignature: appointment.clientSignature,
    clientSignatureName: appointment.clientSignatureName,
    clientSignatureDate: appointment.clientSignatureDate,
    workEvidences: appointment.workEvidences,
    workReport: appointment.workReport,
  });

  const emailTemplate = isTechnicalService ? 'serviceOrder' : 'paymentReceipt';
  const emailData = isTechnicalService ? {
    clientName: appointment.clientName,
    businessName: appointment.Business?.name,
    serviceName: appointment.Service?.name,
    employeeName: appointment.Employee?.User?.name,
    startTime: appointment.startTime,
    price: totalPrice,
    orderNumber,
    notes: appointment.notes,
  } : {
    clientName: appointment.clientName,
    businessName: appointment.Business?.name,
    serviceName: appointment.Service?.name,
    startTime: appointment.startTime,
    price: totalPrice,
    receiptNumber: orderNumber,
  };

  const filename = isTechnicalService ? `reporte-servicio-${orderNumber}.pdf` : `comprobante-${orderNumber}.pdf`;

  await sendEmail(
    clientEmail,
    emailTemplate,
    emailData,
    [{
      filename,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }]
  );

  console.log(`[Email] Comprobante enviado a ${clientEmail} para cita ${appointment.id}`);
}

/**
 * Envia email de solicitud de calificación al cliente
 */
async function sendRatingEmail(appointment) {
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
}

/**
 * Extiende el tiempo de una cita en curso
 */
async function extendTimeAction(appointmentId, data, user) {
  const { additionalMinutes } = data;
  const { getAppointmentById } = require('./queries');
  const { emitAppointmentUpdate } = require('../../services/socketService');

  if (!additionalMinutes || additionalMinutes < 1) {
    throw new Error('Minutos adicionales inválidos');
  }

  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Cita no encontrada');

  if (appointment.status !== 'attention') {
    throw new Error('Solo se pueden extender citas en estado "En Atención"');
  }

  const currentEnd = new Date(appointment.endTime);
  const newEnd = new Date(currentEnd.getTime() + additionalMinutes * 60000);
  const newExtendedDuration = (appointment.extendedDuration || 0) + parseInt(additionalMinutes);

  await appointment.update({ 
    endTime: newEnd,
    extendedDuration: newExtendedDuration
  });

  const updatedAppointment = await getAppointmentById(appointmentId);
  emitAppointmentUpdate(updatedAppointment.toJSON());

  return updatedAppointment;
}

module.exports = {
  createAppointment,
  updateAppointmentStatus,
  cancelAppointment: async (id) => {
    const { Appointment } = require('../../models');
    const appt = await Appointment.findByPk(id);
    if (appt) await appt.update({ status: 'cancelled' });
    return appt;
  },
  updateAppointment: async (id, data) => {
    const { Appointment } = require('../../models');
    const appt = await Appointment.findByPk(id);
    if (appt) await appt.update(data);
    return appt;
  },
  extendTime: extendTimeAction,
  generateReferenceCode,
  sendPaymentReceipt,
  sendRatingEmail
};
