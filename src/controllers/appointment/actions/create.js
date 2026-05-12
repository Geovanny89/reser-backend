const { Appointment, Service, Employee, Business, User, AppointmentEmployee, Deposit, Promotion } = require('../../../models');
const { Op } = require('sequelize');
const { APPOINTMENT_STATUS, MESSAGE_FLOW_STATUS } = require('../constants');
const { emitNewAppointment } = require('../../../services/socketService');
const { scheduleMessage } = require('../../../services/schedulerService');
const { sendEmail } = require('../../../config/email');
const { sendPushNotification } = require('../../../services/pushNotificationService');
const { generateAppointmentCreatedMessage } = require('../../../services/reminder/message.generators');
const { logActivity } = require('../../../utils/activityLogger');

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
 * Crea una nueva cita
 */
async function createAppointment(data, user) {
  const {
    businessId, serviceId, employeeId, clientName, clientPhone, clientEmail, address,
    startTime, notes, status, additionalEmployeeIds = [], depositAmount, depositAccepted,
    extraServices = [], suppliesCost
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
    const { EmployeeService } = require('../../../models');

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
  // Las citas express (status='attention') o creadas por ADMIN están exentas
  const isExpress = status === 'attention';
  const isAdmin = user && (['admin', 'admin_suc', 'superadmin'].includes(user.role));
  
  if (!isExpress && !isAdmin) {
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
  const initialSuppliesCost = suppliesCost !== undefined ? parseFloat(suppliesCost) : (parseFloat(service.suppliesCost) || 0);
  
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
    suppliesCost: initialSuppliesCost,
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
  setImmediate(async () => {
    try {
      const fullAppt = result;
      if (!fullAppt) return;

      // Emitir SOCKET
      try {
        await emitNewAppointment(fullAppt.toJSON(), {
          notifyEmployee: true,
          notifyAdmin: true
        });
      } catch (socketErr) {
        console.error('[Socket] Error emitiendo cita:', socketErr.message);
      }

      const owner = await User.findByPk(fullAppt.Business?.ownerId);

      // Email al owner
      if (owner?.email) {
        sendEmail(owner.email, 'newAppointmentAdmin', {
          businessName: String(fullAppt.Business?.name || ''),
          clientName: String(fullAppt.clientName || ''),
          serviceName: String(fullAppt.Service?.name || ''),
          employeeName: String(fullAppt.Employee?.User?.name || ''),
          startTime: String(fullAppt.startTime || ''),
        }).catch(e => console.error('[Email] Admin notify error:', e.message));
      }

      // Push al dueño
      if (owner?.pushToken) {
        const startTimeStr = new Date(fullAppt.startTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
        sendPushNotification(owner.pushToken, {
          title: '📅 Nueva Cita Agendada',
          body: `${fullAppt.clientName || 'Cliente'} agendó ${fullAppt.Service?.name || 'servicio'} a las ${startTimeStr}`,
        }, {
          type: 'new_appointment',
          appointmentId: fullAppt.id,
          businessName: String(fullAppt.Business?.name || ''),
        }).catch(e => console.error('[Push] Owner notify error:', e.message));
      }

      // Push al empleado
      if (fullAppt.Employee?.User?.pushToken) {
        const startTimeStr = new Date(fullAppt.startTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
        sendPushNotification(fullAppt.Employee.User.pushToken, {
          title: '📅 Nueva Cita Asignada',
          body: `Tienes una cita con ${fullAppt.clientName || 'Cliente'} (${fullAppt.Service?.name || 'Servicio'}) a las ${startTimeStr}`,
        }, {
          type: 'new_appointment',
          appointmentId: fullAppt.id,
          employeeId: fullAppt.employeeId,
        }).catch(e => console.error('[Push] Employee notify error:', e.message));
      }

      // Email al cliente
      let clientEmailTo = fullAppt.clientEmail;
      if (appointment.clientId && !clientEmailTo) {
        const clientUser = await User.findByPk(appointment.clientId);
        clientEmailTo = clientUser?.email || null;
      }
      if (clientEmailTo) {
        sendEmail(clientEmailTo, 'appointmentConfirmation', {
          clientName: String(fullAppt.clientName || ''),
          businessName: String(fullAppt.Business?.name || ''),
          serviceName: String(fullAppt.Service?.name || ''),
          employeeName: String(fullAppt.Employee?.User?.name || ''),
          startTime: String(fullAppt.startTime || ''),
          price: String(fullAppt.finalPrice || fullAppt.Service?.price || ''),
        }).catch(e => console.error('[Email] Client notify error:', e.message));
      }

      // WhatsApp al cliente
      const isExpressAppointment = fullAppt.status === 'attention';
      if (fullAppt.clientPhone && !fullAppt.Business?.hasFieldTechnicians && !isExpressAppointment) {
        const delayMinutes = fullAppt.source === 'kady_chatbot' ? 5 : 1;
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
        } catch (waErr) {
          console.error('[Create Appointment] Error programando mensaje WhatsApp:', waErr.message);
        }
      }
    } catch (e) {
      console.error('[Create Appointment] ❌ ERROR en notificaciones:', e.message);
    }
  });

  return result;
}

module.exports = {
  createAppointment,
  generateReferenceCode
};
