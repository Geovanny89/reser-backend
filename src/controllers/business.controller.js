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
    const nowUTC = Date.now();
    const nowColombia = new Date(nowUTC);

    // Obtener todos los horarios del empleado para el día (incluyendo almuerzos y bloqueos)
    const allSchedules = await Schedule.findAll({
      where: { businessId: biz.id, dayOfWeek, active: true }
    });

    // Agrupar por empleado: work = jornada, lunch = almuerzo, blocked = permiso/bloqueo
    const schedulesByEmployee = {};
    for (const sched of allSchedules) {
      if (!schedulesByEmployee[sched.employeeId]) {
        schedulesByEmployee[sched.employeeId] = { work: [], lunch: [], blocked: [] };
      }
      // Normalizar: si el tipo no es reconocido, tratar como 'work'
      const tipo = ['work', 'lunch', 'blocked'].includes(sched.type) ? sched.type : 'work';
      schedulesByEmployee[sched.employeeId][tipo].push(sched);
    }

    /**
     * Convierte un horario HH:MM a minutos desde medianoche.
     */
    const toMinutes = (timeStr) => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };

    /**
     * Verifica si el intervalo [slotStart, slotEnd) se solapa con [blockStart, blockEnd).
     * Solapamiento ocurre cuando: slotStart < blockEnd && slotEnd > blockStart
     */
    const overlaps = (slotStart, slotEnd, blockStart, blockEnd) => {
      return slotStart < blockEnd && slotEnd > blockStart;
    };

    const slots = [];
    for (const emp of employees) {
      const empSchedules = schedulesByEmployee[emp.id] || { work: [], lunch: [], blocked: [] };

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

        while (current + duration <= workEnd) {
          const slotEndMin = current + duration;

          // Verificar si el slot se solapa con CUALQUIER almuerzo
          const isLunch = lunchRanges.some(r => overlaps(current, slotEndMin, r.start, r.end));

          // Verificar si el slot se solapa con CUALQUIER bloqueo/permiso
          const isBlocked = !isLunch && blockedRanges.some(r => overlaps(current, slotEndMin, r.start, r.end));

          if (!isLunch && !isBlocked) {
            const hh = String(Math.floor(current / 60)).padStart(2, '0');
            const mm = String(current % 60).padStart(2, '0');
            const timeStr = `${hh}:${mm}`;

            // Construir fechas UTC correctas para Colombia
            const slotStart = colombiaDateTimeToUTC(date, timeStr);
            const slotEnd   = new Date(slotStart.getTime() + duration * 60000);

            // No mostrar slots en el pasado
            if (slotStart.getTime() > nowColombia.getTime()) {
              // Verificar conflicto con citas existentes
              const conflict = await Appointment.findOne({
                where: {
                  employeeId: emp.id,
                  status: { [Op.in]: ['pending', 'confirmed', 'attention'] },
                  startTime: { [Op.lt]: slotEnd },
                  endTime:   { [Op.gt]: slotStart },
                }
              });

              if (!conflict) {
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

          current += duration;
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
    const { subscriptionStatus, lastPaymentDate } = req.body;
    await b.update({ subscriptionStatus, lastPaymentDate });
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
    await b.update({ paymentScreenshot, subscriptionStatus: 'pending' });
    res.json({ message: 'Comprobante subido correctamente', business: b });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
