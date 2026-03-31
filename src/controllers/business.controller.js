const { Business, Service, Employee, User } = require('../models');

exports.getAll = async (req, res) => {
  try {
    const businesses = await Business.findAll({
      include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'email'] }]
    });
    res.json(businesses);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// NUEVO: Obtener el negocio del admin autenticado
exports.getMyBusiness = async (req, res) => {
  try {
    const biz = await Business.findOne({
      where: { ownerId: req.user.id },
      include: [
        { model: Service, as: 'Services', where: { active: true }, required: false },
        {
          model: Employee, as: 'Employees', where: { active: true }, required: false,
          include: [{ model: User, attributes: ['id', 'name', 'email'] }]
        }
      ]
    });
    if (!biz) return res.status(404).json({ error: 'No tienes un negocio registrado' });
    res.json(biz);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// NUEVO: Actualizar el negocio del admin autenticado
exports.updateMyBusiness = async (req, res) => {
  try {
    const biz = await Business.findOne({ where: { ownerId: req.user.id } });
    if (!biz) return res.status(404).json({ error: 'No tienes un negocio registrado' });
    const allowed = [
      'name', 'type', 'description', 'phone', 'address', 'logoUrl', 'bannerUrl',
      'whatsapp', 'instagram', 'facebook', 'tiktok', 'twitter', 'website',
      'gallery', 'primaryColor', 'secondaryColor', 'tagline', 'ctaText',
      'businessHours', 'metaDescription',
    ];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    await biz.update(updates);
    res.json(biz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.getBySlug = async (req, res) => {
  try {
    const biz = await Business.findOne({
      where: { slug: req.params.slug },
      include: [
        { model: Service, as: 'Services', where: { active: true }, required: false },
        {
          model: Employee, as: 'Employees', where: { active: true }, required: false,
          include: [{ model: User, attributes: ['id', 'name'] }]
        }
      ]
    });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    res.json(biz);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

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

/**
 * Construye un Date UTC a partir de una fecha "YYYY-MM-DD" y hora "HH:MM"
 * interpretados en zona horaria Colombia (UTC-5).
 */
function colombiaDateTimeToUTC(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00-05:00`);
}

exports.getAvailability = async (req, res) => {
  try {
    const { date, serviceId } = req.query;
    if (!date) return res.status(400).json({ error: 'El parámetro date es requerido' });

    const biz = await Business.findOne({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    const { Appointment, Schedule } = require('../models');
    const { Op } = require('sequelize');

    // Calcular día de la semana en Colombia
    const dayOfWeek = getDayOfWeekColombia(date);

    const employees = await Employee.findAll({
      where: { businessId: biz.id, active: true },
      include: [
        { model: User, attributes: ['id', 'name'] }
      ]
    });

    const service = serviceId ? await Service.findByPk(serviceId) : null;
    const duration = service ? service.durationMin : 60;

    // Hora actual en Colombia para no mostrar slots pasados
    const nowColombia = new Date();

    // Obtener todos los horarios del empleado para el día (incluyendo almuerzos y bloqueos)
    const allSchedules = await Schedule.findAll({
      where: { businessId: biz.id, dayOfWeek, active: true }
    });

    // Obtener todas las citas del negocio para ese día para evitar consultas en el bucle
    const startOfDay = colombiaDateFromString(date);
    const endOfDay   = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const dayAppointments = await Appointment.findAll({
      where: {
        businessId: biz.id,
        status: { [Op.or]: [{ [Op.notIn]: ['cancelled'] }, { [Op.is]: null }] },
        startTime: { [Op.lt]: endOfDay },
        endTime:   { [Op.gt]: startOfDay }
      }
    });

    // Agrupar por empleado: work = jornada, lunch = almuerzo, blocked = permiso/bloqueo
    const schedulesByEmployee = {};
    for (const sched of allSchedules) {
      if (!schedulesByEmployee[sched.employeeId]) {
        schedulesByEmployee[sched.employeeId] = { work: [], lunch: [], blocked: [] };
      }
      // Normalizar y limpiar tipo
      const rawType = (sched.type || 'work').trim().toLowerCase();
      const tipo = ['work', 'lunch', 'blocked'].includes(rawType) ? rawType : 'work';
      schedulesByEmployee[sched.employeeId][tipo].push(sched);
    }

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
      return slotStart < blockEnd && slotEnd > blockStart;
    };

    const slots = [];
    for (const emp of employees) {
      const empSchedules = schedulesByEmployee[emp.id] || { work: [], lunch: [], blocked: [] };
      const empAppointments = dayAppointments.filter(a => a.employeeId === emp.id);

      // Pre-calcular rangos de almuerzo y bloqueo en minutos para este empleado
      const lunchRanges = empSchedules.lunch.map(s => ({
        start: toMinutes(s.startTime),
        end:   toMinutes(s.endTime),
      }));
      const blockedRanges = empSchedules.blocked.map(s => ({
        start: toMinutes(s.startTime),
        end:   toMinutes(s.endTime),
      }));

      // Procesar solo horarios de trabajo
      for (const sched of empSchedules.work) {
        const workStart = toMinutes(sched.startTime);
        const workEnd   = toMinutes(sched.endTime);
        let current = workStart;

        // Si el servicio dura 0 o es inválido, usar 30 min por defecto
        const safeDuration = (duration && duration > 0) ? duration : 30;

        while (current + safeDuration <= workEnd) {
          const slotEndMin = current + safeDuration;

          // Verificar si el slot se solapa con CUALQUIER almuerzo
          const isLunch = lunchRanges.some(r => overlaps(current, slotEndMin, r.start, r.end));

          // Verificar si el slot se solapa con CUALQUIER bloqueo/permiso
          const isBlocked = isLunch || blockedRanges.some(r => overlaps(current, slotEndMin, r.start, r.end));

          if (!isBlocked) {
            const hh = String(Math.floor(current / 60)).padStart(2, '0');
            const mm = String(current % 60).padStart(2, '0');
            const timeStr = `${hh}:${mm}`;

            // Construir fechas UTC correctas para Colombia
            const slotStart = colombiaDateTimeToUTC(date, timeStr);
            const slotEnd   = new Date(slotStart.getTime() + safeDuration * 60000);

            // No mostrar slots en el pasado (con un margen de 5 minutos para permitir reservar citas muy cercanas)
            const MARGIN_MS = 5 * 60 * 1000;
            if (slotStart.getTime() > (Date.now() - MARGIN_MS)) {
              // Verificar conflicto con citas existentes en memoria
              const hasConflict = empAppointments.some(appt => {
                const apptStart = new Date(appt.startTime).getTime();
                const apptEnd   = new Date(appt.endTime).getTime();
                return apptStart < slotEnd.getTime() && apptEnd > slotStart.getTime();
              });

              if (!hasConflict) {
                slots.push({
                  employeeId:   emp.id,
                  employeeName: emp.User.name,
                  startTime:    slotStart,
                  endTime:      slotEnd,
                  localTime:    timeStr,
                });
              }
            }
          }

          current += 30; // Siempre avanzar en intervalos de 30 minutos para ofrecer más opciones
        }
      }
    }

    // Ordenar por hora
    slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    res.json(slots);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, type, description, phone, address, logoUrl } = req.body;
    const ownerId = req.body.ownerId || req.user.id;
    const biz = await Business.create({ name, type, description, phone, address, logoUrl, ownerId });
    res.status(201).json(biz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const biz = await Business.findByPk(req.params.id);
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    await biz.update(req.body);
    res.json(biz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const biz = await Business.findByPk(req.params.id);
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    await biz.destroy();
    res.json({ message: 'Negocio eliminado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.toggleStatus = async (req, res) => {
  try {
    const b = await Business.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    const newStatus = b.status === 'active' ? 'blocked' : 'active';
    await b.update({ status: newStatus });

    // También bloquear/desbloquear al dueño del negocio
    await User.update({ status: newStatus }, { where: { id: b.ownerId } });

    res.json(b);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.updateSubscription = async (req, res) => {
  try {
    const b = await Business.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    const { subscriptionStatus, lastPaymentDate, subscriptionStartDate, subscriptionEndDate } = req.body;
    
    const updates = { 
      subscriptionStatus, 
      lastPaymentDate,
      subscriptionStartDate,
      subscriptionEndDate
    };

    // Si el SuperAdmin marca como "paid", eliminamos el comprobante para que no salga el aviso
    if (subscriptionStatus === 'paid') {
      updates.paymentScreenshot = null;
    }

    await b.update(updates);
    res.json(b);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.uploadPaymentScreenshot = async (req, res) => {
  try {
    const b = await Business.findOne({ where: { ownerId: req.user.id } });
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    
    const paymentScreenshot = `/uploads/${req.file.filename}`;
    
    // Al subir comprobante, el estado pasa a pending y si estaba bloqueado por falta de pago, se mantiene bloqueado
    // hasta que el SuperAdmin lo apruebe, O puedes decidir desbloquearlo automáticamente aquí.
    // Según tu solicitud: "se debe bloquear automáticamente hasta que se envie" implica que el envío es el disparador.
    // Vamos a desbloquearlo automáticamente al enviar el comprobante para mejorar la experiencia de usuario.
    
    await b.update({ 
      paymentScreenshot, 
      subscriptionStatus: 'pending',
      status: 'active' // Desbloqueo automático al enviar comprobante
    });
    
    res.json({ message: 'Comprobante subido correctamente y negocio activado', business: b });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
