const { Appointment, Service, Employee, User, Business } = require('../models');
const { Op } = require('sequelize');
const { sendEmail } = require('../config/email');
const { generatePaymentReceipt } = require('../utils/pdfGenerator');

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
    
    const { date, status } = req.query;
    const where = { businessId };
    if (status) where.status = status;
    if (date) {
      // Usar fecha local de Colombia (UTC-5)
      const d = new Date(`${date}T00:00:00-05:00`);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      where.startTime = { [Op.between]: [d, next] };
    }
    const appointments = await Appointment.findAll({
      where,
      include: [
        { model: Service },
        { model: Employee, include: [{ model: User, attributes: ['name'] }] }
      ],
      order: [['startTime', 'ASC']]
    });
    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getMyAppointments = async (req, res) => {
  try {
    const emp = await Employee.findOne({ where: { userId: req.user.id } });
    if (!emp) return res.status(404).json({ error: 'Perfil de empleado no encontrado' });

    const appointments = await Appointment.findAll({
      where: { employeeId: emp.id, status: { [Op.in]: ['pending', 'confirmed', 'attention'] } },
      include: [{ model: Service }],
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
    const { businessId, serviceId, employeeId, clientName, clientPhone, clientEmail, startTime, notes } = req.body;

    const service = await Service.findByPk(serviceId);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

    const start = new Date(startTime);
    const end = new Date(start.getTime() + service.durationMin * 60000);

    const conflict = await Appointment.findOne({
      where: {
        employeeId,
        status: { [Op.or]: [{ [Op.notIn]: ['cancelled'] }, { [Op.is]: null }] }, // Bloquear por cualquier cita que NO esté cancelada
        startTime: { [Op.lt]: end },
        endTime: { [Op.gt]: start },
      }
    });
    if (conflict) return res.status(409).json({ error: 'El empleado ya tiene una cita en ese horario' });

    const appt = await Appointment.create({
      businessId, serviceId, employeeId, clientName, clientPhone,
      clientEmail: clientEmail ? clientEmail.toLowerCase().trim() : null,
      clientId: (req.user && req.user.role === 'client') ? req.user.id : (req.body.clientId || null),
      startTime: start, endTime: end, notes,
    });
    // Notificaciones automáticas (sin bloquear la respuesta)
    setImmediate(async () => {
      try {
        const fullAppt = await Appointment.findByPk(appt.id, {
          include: [
            { model: Service },
            { model: Employee, include: [{ model: User, attributes: ['name'] }] },
            { model: Business },
          ],
        });
        if (!fullAppt) return;
        const owner = await User.findByPk(fullAppt.Business?.ownerId);
        if (owner?.email) {
          await sendEmail(owner.email, 'newAppointmentAdmin', {
            businessName: String(fullAppt.Business?.name || ''),
            clientName:   String(fullAppt.clientName || ''),
            serviceName:  String(fullAppt.Service?.name || ''),
            employeeName: String(fullAppt.Employee?.User?.name || ''),
            startTime:    String(fullAppt.startTime || ''),
          }).catch(e => console.error('[Email] Admin notify error:', e.message));
        }
        // Determinar el email del cliente: usuario registrado o email proporcionado en la reserva
        let clientEmailTo = null;
        if (appt.clientId) {
          const clientUser = await User.findByPk(appt.clientId);
          clientEmailTo = clientUser?.email || null;
        }
        // Si no hay usuario registrado, usar el email proporcionado directamente
        if (!clientEmailTo && fullAppt.clientEmail) {
          clientEmailTo = fullAppt.clientEmail;
        }
        if (clientEmailTo) {
          await sendEmail(clientEmailTo, 'appointmentConfirmation', {
            clientName:   String(fullAppt.clientName || ''),
            businessName: String(fullAppt.Business?.name || ''),
            serviceName:  String(fullAppt.Service?.name || ''),
            employeeName: String(fullAppt.Employee?.User?.name || ''),
            startTime:    String(fullAppt.startTime || ''),
            price:        String(fullAppt.Service?.price || ''),
          }).catch(e => console.error('[Email] Client notify error:', e.message));
        }
      } catch (e) {
        console.error('[Email] Notification error:', e.message);
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
      ],
    });
    if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
    
    const oldStatus = appt.status;
    await appt.update({ status: req.body.status });

    // Si la cita se marca como completada, enviar comprobante de pago
    if (req.body.status === 'done' && oldStatus !== 'done') {
      setImmediate(async () => {
        try {
          await sendPaymentReceipt(appt);
        } catch (e) {
          console.error('[Email] Error enviando comprobante de pago:', e.message);
        }
      });
    }

    res.json(appt);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// Función auxiliar para enviar comprobante de pago
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

  // Generar PDF del comprobante
  const pdfBuffer = await generatePaymentReceipt({
    businessId: appointment.businessId,
    businessName: appointment.Business?.name,
    businessLogoUrl: appointment.Business?.logoUrl, // CORREGIDO: Usar logoUrl
    businessAddress: appointment.Business?.address,
    businessPhone: appointment.Business?.phone,
    businessNit: appointment.Business?.nit,
    id: appointment.id,
    clientName: appointment.clientName,
    clientEmail: appointment.clientEmail,
    clientPhone: appointment.clientPhone,
    serviceName: appointment.Service?.name,
    employeeName: appointment.Employee?.User?.name,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    price: appointment.Service?.price,
    paymentMethod: appointment.paymentMethod || 'Efectivo',
    notes: appointment.notes,
  });

  // Enviar email con PDF adjunto
  const receiptNumber = appointment.id.substring(0, 8).toUpperCase();
  await sendEmail(
    clientEmail,
    'paymentReceipt',
    {
      clientName: appointment.clientName,
      businessName: appointment.Business?.name,
      serviceName: appointment.Service?.name,
      startTime: appointment.startTime,
      price: appointment.Service?.price,
      receiptNumber,
    },
    [
      {
        filename: `comprobante-${receiptNumber}.pdf`,
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
    const isAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'superadmin');
    
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
          error: 'no puedes cancelar por favor comunicate con el negocio' 
        });
      }
    }
    
    await appt.update({ status: 'cancelled' });
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

    const { Appointment, Schedule } = require('../models');
    const { Op } = require('sequelize');

    const service = await Service.findByPk(serviceId);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

    const duration = service.durationMin || 60;
    const nowColombia = new Date();
    const dayOfWeek = getDayOfWeekColombia(date);

    // Obtener horarios (trabajo, almuerzo, bloqueos)
    const empSchedules = await Schedule.findAll({
      where: { employeeId, dayOfWeek, active: true }
    });

    const workSchedules = empSchedules.filter(s => {
      const type = (s.type || 'work').trim().toLowerCase();
      return type === 'work';
    });
    if (workSchedules.length === 0) {
      return res.json({ availableSlots: [] });
    }

    const lunchRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch').map(s => ({
      start: s.startTime,
      end: s.endTime
    }));
    const blockedRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked').map(s => ({
      start: s.startTime,
      end: s.endTime
    }));

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
     * Verifica si el intervalo [slotStart, slotEnd) se solapa con [blockStart, blockEnd).
     */
    const overlaps = (slotStart, slotEnd, blockStart, blockEnd) => {
      const bStart = toMinutes(blockStart);
      const bEnd = toMinutes(blockEnd);
      return slotStart < bEnd && slotEnd > bStart;
    };

    const availableSlots = [];

    for (const sched of workSchedules) {
      const workStart = toMinutes(sched.startTime);
      const workEnd = toMinutes(sched.endTime);
      let current = workStart;

      const safeDuration = (duration && duration > 0) ? duration : 30;

      while (current + safeDuration <= workEnd) {
        const slotEndMin = current + safeDuration;

        // Preparar timeStr primero
        const hh = String(Math.floor(current / 60)).padStart(2, '0');
        const mm = String(current % 60).padStart(2, '0');
        const timeStr = `${hh}:${mm}`;

        // 1. Verificar Almuerzo
        const isLunch = lunchRanges.some(r => overlaps(current, slotEndMin, r.start, r.end));
        // 2. Verificar Bloqueos
        const isBlocked = isLunch || blockedRanges.some(r => overlaps(current, slotEndMin, r.start, r.end));

        if (!isBlocked) {
          const slotTime = colombiaDateTimeToUTC(date, timeStr);
          const slotEndTime = new Date(slotTime.getTime() + safeDuration * 60000);
          
          // 3. Verificar Citas Existentes
          const hasConflict = existingAppointments.some(appt => {
            const apptStart = new Date(appt.startTime).getTime();
            const apptEnd   = new Date(appt.endTime).getTime();
            return apptStart < slotEndTime.getTime() && apptEnd > slotTime.getTime();
          });

          // 4. Verificar que no sea en el pasado
          const MARGIN_MS = 5 * 60 * 1000;
          if (slotTime.getTime() > (Date.now() - MARGIN_MS) && !hasConflict) {
            availableSlots.push(timeStr);
          }
        }
        current += 30; // Intervalos de 30 min para generar opciones
      }
    }

    // Eliminar duplicados de horarios (en caso de múltiples jornadas de trabajo solapadas)
    const uniqueSlots = [...new Set(availableSlots)].sort();

    res.json({ availableSlots: uniqueSlots });
  } catch (e) {
    console.error('Error en getAvailability:', e);
    res.status(500).json({ error: e.message });
  }
};
