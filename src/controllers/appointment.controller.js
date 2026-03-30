const { Appointment, Service, Employee, User, Business } = require('../models');
const { Op } = require('sequelize');
const { sendEmail } = require('../config/email');
const { generatePaymentReceipt } = require('../utils/pdfGenerator');

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
      where.clientEmail = email;
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
        status: { [Op.in]: ['pending', 'confirmed', 'attention'] },
        startTime: { [Op.lt]: end },
        endTime: { [Op.gt]: start },
      }
    });
    if (conflict) return res.status(409).json({ error: 'El empleado ya tiene una cita en ese horario' });

    const appt = await Appointment.create({
      businessId, serviceId, employeeId, clientName, clientPhone,
      clientEmail: clientEmail || null,
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
            businessName: fullAppt.Business?.name,
            clientName:   fullAppt.clientName,
            serviceName:  fullAppt.Service?.name,
            employeeName: fullAppt.Employee?.User?.name,
            startTime:    fullAppt.startTime,
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
            clientName:   fullAppt.clientName,
            businessName: fullAppt.Business?.name,
            serviceName:  fullAppt.Service?.name,
            employeeName: fullAppt.Employee?.User?.name,
            startTime:    fullAppt.startTime,
            price:        fullAppt.Service?.price,
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
    businessLogo: appointment.Business?.logo,
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
    
    console.log('Parámetros recibidos:', { date, employeeId, serviceId, businessId });
    
    if (!date || !employeeId || !serviceId || !businessId) {
      console.log('Faltan parámetros:', { date, employeeId, serviceId, businessId });
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    // Obtener el servicio para calcular duración
    const service = await Service.findByPk(serviceId);
    if (!service) {
      console.log('Servicio no encontrado:', serviceId);
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    console.log('Duración del servicio:', service.durationMin, 'minutos');

    // Obtener citas existentes para ese empleado en esa fecha
    const startOfDay = new Date(date + 'T00:00:00');
    const endOfDay = new Date(date + 'T23:59:59');

    console.log('Buscando citas entre:', startOfDay, 'y', endOfDay);

    const existingAppointments = await Appointment.findAll({
      where: {
        employeeId,
        businessId,
        status: { [Op.in]: ['pending', 'confirmed', 'attention'] },
        startTime: { [Op.between]: [startOfDay, endOfDay] }
      },
      include: [{ model: Service }]
    });

    console.log('Citas existentes encontradas:', existingAppointments.length);

    // Generar slots disponibles (ejemplo: cada 30 minutos de 8am a 6pm)
    const availableSlots = [];
    const startHour = 8;
    const endHour = 18;
    const slotDuration = 30; // minutos

    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += slotDuration) {
        const slotTime = new Date(date);
        slotTime.setHours(hour, minute, 0, 0);
        
        const slotEndTime = new Date(slotTime.getTime() + service.durationMin * 60000);
        
        // Verificar si el slot está disponible
        const isAvailable = !existingAppointments.some(apt => {
          const aptStart = new Date(apt.startTime);
          const aptEnd = new Date(apt.endTime);
          return (slotTime < aptEnd && slotEndTime > aptStart);
        });

        if (slotTime > new Date() && isAvailable) {
          availableSlots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
        }
      }
    }

    console.log('Slots generados:', availableSlots);

    res.json({ availableSlots });
  } catch (e) {
    console.error('Error en getAvailability:', e);
    res.status(500).json({ error: e.message });
  }
};
