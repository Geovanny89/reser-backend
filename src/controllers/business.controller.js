const { Business, Service, Employee, User, Promotion, Appointment, ServiceGroup, sequelize } = require('../models');
const { deleteFromCloudinary } = require('../config/cloudinary');
const { sendEmail } = require('../config/email');
const { Op } = require('sequelize');

exports.getAll = async (req, res) => {
  try {
    const businesses = await Business.findAll({
      include: [
        { model: User, as: 'Owner', attributes: ['id', 'name', 'email'] },
        { model: Business, as: 'ParentBusiness', attributes: ['id', 'name', 'whatsapp'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    res.json(businesses);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// NUEVO: Obtener el negocio del admin autenticado
exports.getMyBusiness = async (req, res) => {
  try {
    const userId = req.user.id;
    const { businessId } = req.query;
    
    let biz = null;

    // 1. Si se solicita un negocio específico
    if (businessId) {
      biz = await Business.findByPk(businessId, {
        include: [
          { model: Service, as: 'Services', where: { active: true }, required: false },
          {
            model: Employee, as: 'Employees', where: { active: true }, required: false,
            include: [{ model: User, attributes: ['id', 'name', 'email'] }]
          },
          { model: Business, as: 'ParentBusiness', attributes: ['id', 'name', 'whatsapp'] }
        ]
      });

      if (biz) {
        // Verificar si es dueño o manager
        const isOwner = biz.ownerId === userId;
        const emp = await Employee.findOne({ where: { userId, businessId: biz.id, isManager: true } });
        const isManager = !!emp || req.user.role === 'admin_suc';

        if (!isOwner && !isManager) {
          return res.status(403).json({ error: 'Sin permisos para este negocio' });
        }
      }
    }

    // 2. Si no hay negocio específico o no se encontró, buscar el principal/asignado
    if (!biz) {
      // Buscar si el usuario es el DUEÑO de algún negocio
      biz = await Business.findOne({
        where: { ownerId: userId },
        include: [
          { model: Service, as: 'Services', where: { active: true }, required: false },
          {
            model: Employee, as: 'Employees', where: { active: true }, required: false,
            include: [{ model: User, attributes: ['id', 'name', 'email'] }]
          },
          { model: Business, as: 'ParentBusiness', attributes: ['id', 'name', 'whatsapp'] }
        ],
        order: [['isBranch', 'ASC']] // Primero negocios principales
      });

      // Si no es dueño, buscar si es un EMPLEADO con permisos de gestión
      if (!biz) {
        const emp = await Employee.findOne({ 
          where: { userId },
          attributes: ['businessId', 'isManager']
        });

        if (emp && (emp.isManager || req.user.role === 'admin_suc')) {
          biz = await Business.findByPk(emp.businessId, {
            include: [
              { model: Service, as: 'Services', where: { active: true }, required: false },
              {
                model: Employee, as: 'Employees', where: { active: true }, required: false,
                include: [{ model: User, attributes: ['id', 'name', 'email'] }]
              },
              { model: Business, as: 'ParentBusiness', attributes: ['id', 'name', 'whatsapp'] }
            ]
          });
        }
      }
    }

    if (!biz) return res.status(404).json({ error: 'No tienes un negocio registrado o asignado' });
    res.json(biz);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, type, ownerId, parentBusinessId } = req.body;
    
    let isBranch = false;
    let branchStatus = 'none';
    let status = 'active';

    if (parentBusinessId) {
      isBranch = true;
      branchStatus = 'pending_approval';
      status = 'blocked'; // Bloqueada hasta que el superadmin la apruebe
    }

    const biz = await Business.create({
      ...req.body,
      isBranch,
      branchStatus,
      status
    });

    res.status(201).json(biz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.requestBranch = async (req, res) => {
  try {
    const { name, type, address, phone, branchPaymentScreenshot } = req.body;
    
    // Buscar el negocio principal del usuario
    let parentBiz = await Business.findOne({ 
      where: { ownerId: req.user.id },
      order: [['isBranch', 'ASC']]
    });
    
    // Si no es el dueño, podría ser un admin_suc de una sucursal que quiere crear otra sucursal?
    // Generalmente solo el dueño (admin) crea sucursales, pero si admin_suc debe tener "mismos permisos"
    if (!parentBiz && req.user.role === 'admin_suc') {
      const emp = await Employee.findOne({ where: { userId: req.user.id, isManager: true } });
      if (emp) {
        const currentBiz = await Business.findByPk(emp.businessId);
        if (currentBiz.isBranch) {
          parentBiz = await Business.findByPk(currentBiz.parentBusinessId);
        } else {
          parentBiz = currentBiz;
        }
      }
    }

    if (!parentBiz) return res.status(404).json({ error: 'No tienes un negocio principal registrado' });

    const branch = await Business.create({
      name,
      type: type || 'otro',
      address,
      phone,
      ownerId: parentBiz.ownerId, // La sucursal pertenece al mismo dueño que el negocio principal
      parentBusinessId: parentBiz.id,
      isBranch: true,
      branchStatus: 'pending_approval',
      status: 'blocked',
      subscriptionStatus: 'pending',
      branchPaymentScreenshot // Este campo es el que lee el superadmin
    });

    res.status(201).json(branch);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.approveBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { approve } = req.body; // true o false

    const branch = await Business.findByPk(id);
    if (!branch || !branch.isBranch) return res.status(404).json({ error: 'Sucursal no encontrada' });

    if (approve) {
      await branch.update({
        branchStatus: 'approved',
        status: 'active',
        subscriptionStatus: 'paid',
        subscriptionStartDate: new Date(),
        subscriptionEndDate: new Date(new Date().setMonth(new Date().getMonth() + 1)) // 1 mes inicial
      });
    } else {
      await branch.update({
        branchStatus: 'rejected',
        status: 'blocked'
      });
    }

    res.json({ message: approve ? 'Sucursal aprobada y activada' : 'Sucursal rechazada' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getMyBranches = async (req, res) => {
  try {
    // Buscar el negocio principal
    let parentBiz = await Business.findOne({ 
      where: { ownerId: req.user.id },
      order: [['isBranch', 'ASC']]
    });

    // Si no es el dueño, podría ser un admin_suc de una sucursal
    if (!parentBiz && req.user.role === 'admin_suc') {
      const emp = await Employee.findOne({ where: { userId: req.user.id, isManager: true } });
      if (emp) {
        const currentBiz = await Business.findByPk(emp.businessId);
        if (currentBiz.isBranch) {
          parentBiz = await Business.findByPk(currentBiz.parentBusinessId);
        } else {
          parentBiz = currentBiz;
        }
      }
    }

    if (!parentBiz) return res.json([]);

    const branches = await Business.findAll({
      where: { parentBusinessId: parentBiz.id }
    });
    res.json(branches);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// NUEVO: Actualizar el negocio del admin autenticado
exports.updateMyBusiness = async (req, res) => {
  try {
    const { businessId } = req.query;
    let biz = null;

    if (businessId) {
      biz = await Business.findByPk(businessId);
      if (biz) {
        const isOwner = biz.ownerId === req.user.id;
        const emp = await Employee.findOne({ where: { userId: req.user.id, businessId: biz.id, isManager: true } });
        const isManager = !!emp || req.user.role === 'admin_suc';
        if (!isOwner && !isManager) return res.status(403).json({ error: 'Sin permisos' });
      }
    }

    if (!biz) {
      biz = await Business.findOne({ 
        where: { ownerId: req.user.id },
        order: [['isBranch', 'ASC']]
      });

      // Si no es el dueño, buscar si es un admin_suc gestionando su sucursal
      if (!biz && req.user.role === 'admin_suc') {
        const emp = await Employee.findOne({ where: { userId: req.user.id, isManager: true } });
        if (emp) biz = await Business.findByPk(emp.businessId);
      }
    }

    if (!biz) return res.status(404).json({ error: 'No tienes un negocio registrado o asignado' });
    
    const allowed = [
      'name', 'type', 'description', 'phone', 'address', 'logoUrl', 'bannerUrl',
      'whatsapp', 'whatsappCatalog', 'instagram', 'facebook', 'tiktok', 'twitter', 'pinterest', 'youtube', 'website',
      'gallery', 'primaryColor', 'secondaryColor', 'tagline', 'ctaText',
      'businessHours', 'metaDescription', 'isTechnicalServices', 'hasFieldTechnicians',
      'showPaymentMethods', 'paymentMethods', 'useParentWhatsApp',
      'showMissionVision', 'mission', 'vision', 'googleMapsUrl',
      'enabledModules', 'depositConfig',
    ];
    
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    // ELIMINAR DE CLOUDINARY SI CAMBIAN
    if (updates.logoUrl && biz.logoUrl && updates.logoUrl !== biz.logoUrl) {
      await deleteFromCloudinary(biz.logoUrl);
    }
    if (updates.bannerUrl && biz.bannerUrl && updates.bannerUrl !== biz.bannerUrl) {
      await deleteFromCloudinary(biz.bannerUrl);
    }

    await biz.update(updates);
    res.json(biz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.getBySlug = async (req, res) => {
  try {
    const { BusinessReview } = require('../models');
    
    const biz = await Business.findOne({
      where: { slug: req.params.slug },
      include: [
        { 
          model: Service, 
          as: 'Services', 
          where: { active: true }, 
          required: false,
          attributes: ['id', 'name', 'description', 'price', 'durationMin', 'isTechnicalService', 'priceOptional', 'imageUrl', 'serviceGroupId']
        },
        {
          model: ServiceGroup,
          as: 'ServiceGroups',
          where: { active: true },
          required: false,
          include: [{
            model: Service,
            as: 'Services',
            where: { active: true },
            required: false,
            attributes: ['id', 'name', 'description', 'price', 'durationMin', 'isTechnicalService', 'priceOptional', 'imageUrl']
          }]
        },
        {
          model: Employee, as: 'Employees', where: { active: true }, required: false,
          attributes: ['id', 'businessId', 'userId', 'specialty', 'photoUrl', 'description', 'isManager', 'active'],
          include: [
            { model: User, attributes: ['id', 'name'] },
            { 
              model: Service, 
              as: 'Services',
              attributes: ['id', 'name'], 
              through: { attributes: [] },
              required: false
            }
          ]
        }
      ]
    });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Obtener promociones activas
    const now = new Date();
    const promotions = await Promotion.findAll({
      where: {
        businessId: biz.id,
        active: true,
        startDate: { [Op.lte]: now },
        endDate: { [Op.gte]: now }
      },
      include: [{ model: Service, attributes: ['name'] }]
    });

    // Obtener reseñas aprobadas del negocio
    const reviews = await BusinessReview.findAll({
      where: { 
        businessId: biz.id,
        isApproved: true 
      },
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    const bizJson = biz.toJSON();
    
    // Asegurar valores por defecto para módulos y configuración de anticipos
    bizJson.enabledModules = bizJson.enabledModules || { expenses: false, inventory: false, deposits: false };
    bizJson.depositConfig = bizJson.depositConfig || {
      required: false,
      amount: 0,
      percentage: 30,
      cancelationHours: 24,
      penaltyEnabled: true,
      termsText: 'El anticipo garantiza tu cita. Si cancelas con menos de 24 horas de anticipo o no asistes, el anticipo será retenido como penalidad.'
    };
    
    bizJson.Promotions = promotions;
    bizJson.Reviews = reviews;
    
    // Calcular estadísticas de reseñas
    const totalReviews = reviews.length;
    const avgRating = totalReviews > 0 
      ? (reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1)
      : null;
    
    bizJson.ReviewStats = {
      avgRating: avgRating ? parseFloat(avgRating) : null,
      totalReviews
    };
    
    // Asignar promociones a los servicios
    // Convertir promociones a objetos planos para comparación correcta
    const promotionsPlain = promotions.map(p => p.toJSON());
    
    if (bizJson.Services) {
      bizJson.Services = bizJson.Services.map(svc => {
        const svcPromos = promotionsPlain.filter(p => p.serviceId === svc.id || p.applyToAllServices);
        return { ...svc, Promotions: svcPromos };
      });
    }
    
    // También asignar promociones a servicios dentro de los grupos
    if (bizJson.ServiceGroups) {
      bizJson.ServiceGroups = bizJson.ServiceGroups.map(group => {
        if (group.Services) {
          group.Services = group.Services.map(svc => {
            const svcPromos = promotionsPlain.filter(p => p.serviceId === svc.id || p.applyToAllServices);
            return { ...svc, Promotions: svcPromos };
          });
        }
        return group;
      });
    }

    res.json(bizJson);
  } catch (e) {
    console.error('[getBySlug] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// NUEVO: Obtener negocio por ID (público, para empleados)
exports.getByIdPublic = async (req, res) => {
  try {
    const biz = await Business.findByPk(req.params.id, {
      attributes: [
        'id', 'name', 'slug', 'type', 'description', 'phone', 'address', 
        'logoUrl', 'bannerUrl', 'primaryColor', 'secondaryColor', 
        'whatsapp', 'whatsappCatalog', 'instagram', 'facebook', 'tiktok', 'twitter', 'website', 
        'status', 'showMissionVision', 'mission', 'vision', 'googleMapsUrl',
        'isTechnicalServices', 'hasFieldTechnicians'
      ]
    });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (biz.status === 'blocked') return res.status(403).json({ error: 'Negocio bloqueado' });
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

    const { Appointment, Schedule, SpecialSchedule, sequelize } = require('../models');
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
    const nowColombia = new Date(new Date().getTime() + COLOMBIA_OFFSET_MS);
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const isTargetToday = date === todayStr;

    // Verificar si hay horarios especiales para esta fecha (festivos, días especiales)
    const [month, dayNum] = date.split('-').slice(1);
    const allSpecialSchedules = await SpecialSchedule.findAll({
      where: {
        businessId: biz.id,
        active: true,
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
      }
    });

    // Obtener todos los horarios regulares del negocio para el día
    const allRegularSchedules = await Schedule.findAll({
      where: { businessId: biz.id, dayOfWeek, active: true }
    });

    // Obtener todas las citas del negocio para ese día para evitar consultas en el bucle
    const startOfDay = colombiaDateFromString(date);
    const endOfDay   = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const dayAppointments = await Appointment.findAll({
      where: {
        businessId: biz.id,
        status: { [Op.notIn]: ['cancelled'] },
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

    const slots = [];
    const nowMs = Date.now();
    const MARGIN_MS = 5 * 60 * 1000; // 5 minutos de gracia

    // DEBUG: Log para verificar zona horaria
    console.log('[Availability DEBUG]', {
      serverTime: new Date().toISOString(),
      nowColombia: nowColombia.toISOString(),
      todayStr,
      requestedDate: date,
      isTargetToday,
      nowMs,
      marginMs: MARGIN_MS,
      threshold: nowMs - MARGIN_MS
    });

    for (const emp of employees) {
      const empAppointments = dayAppointments.filter(a => String(a.employeeId) === String(emp.id));

      // Buscar horarios especiales para este empleado
      const empSpecialSchedules = allSpecialSchedules.filter(s => 
        s.employeeId === null || String(s.employeeId) === String(emp.id)
      );

      let empSchedules;
      let workSchedules = [];
      let lunchRanges = [];
      let blockedRanges = [];

      if (empSpecialSchedules.length > 0) {
        // Verificar si el empleado está cerrado ese día
        const closedSchedule = empSpecialSchedules.find(s => s.type === 'closed');
        if (closedSchedule) {
          console.log(`[Availability] Empleado ${emp.id} cerrado el ${date}: ${closedSchedule.description}`);
          continue; // Saltar a siguiente empleado
        }

        // Usar horarios especiales
        empSchedules = empSpecialSchedules;
        workSchedules = empSpecialSchedules.filter(s => s.type === 'work');
        lunchRanges = empSpecialSchedules.filter(s => s.type === 'lunch');
        blockedRanges = empSpecialSchedules.filter(s => s.type === 'blocked');
      } else {
        // Usar horarios regulares
        empSchedules = allRegularSchedules.filter(s => String(s.employeeId) === String(emp.id));
        workSchedules = empSchedules.filter(s => (s.type || 'work').trim().toLowerCase() === 'work');
        lunchRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch');
        blockedRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked');
      }

      for (const sched of workSchedules) {
        const workStart = toMinutes(sched.startTime);
        const workEnd   = toMinutes(sched.endTime);
        let current = workStart;

        const safeDuration = (duration && duration > 0) ? Number(duration) : 30;

        while (current + safeDuration <= workEnd) {
          const hh = String(Math.floor(current / 60)).padStart(2, '0');
          const mm = String(current % 60).padStart(2, '0');
          const timeStr = `${hh}:${mm}`;

          const slotStart = colombiaDateTimeToUTC(date, timeStr);
          const slotEnd   = new Date(slotStart.getTime() + safeDuration * 60000);

          // 1. Filtrar si ya pasó (si es hoy)
          if (isTargetToday && slotStart.getTime() <= (nowMs - MARGIN_MS)) {
            console.log(`[Availability DEBUG] Slot ${timeStr} filtrado: slotStart=${slotStart.getTime()} <= threshold=${nowMs - MARGIN_MS}`);
            current += 5;
            continue;
          }

          // 2. Verificar Citas Existentes
          const conflictAppt = empAppointments.find(appt => {
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
          slots.push({
            employeeId:   emp.id,
            employeeName: emp.User.name,
            startTime:    slotStart,
            endTime:      slotEnd,
            localTime:    timeStr,
          });

          // Avanzar al siguiente intervalo según la duración del servicio
          current += safeDuration;
        }
      }
    }

    // Ordenar por hora
    slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    // Eliminar duplicados exactos (mismo empleado y misma hora de inicio)
    const uniqueSlots = [];
    const seen = new Set();
    
    for (const slot of slots) {
      const key = `${slot.employeeId}-${slot.localTime}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueSlots.push(slot);
      }
    }

    res.json(uniqueSlots);
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

    const { Appointment, Service, Employee, Schedule } = require('../models');

    // ELIMINAR EN ORDEN POR DEPENDENCIAS
    // 1. Primero eliminar citas (appointments dependen de employees y services)
    await Appointment.destroy({ where: { businessId: biz.id } });
    
    // 2. Eliminar schedules (dependen de employees)
    await Schedule.destroy({ where: { businessId: biz.id } });
    
    // 3. Eliminar employees
    await Employee.destroy({ where: { businessId: biz.id } });
    
    // 4. Eliminar services
    await Service.destroy({ where: { businessId: biz.id } });

    // 5. ELIMINAR TODAS LAS IMÁGENES DE CLOUDINARY
    if (biz.logoUrl) await deleteFromCloudinary(biz.logoUrl);
    if (biz.bannerUrl) await deleteFromCloudinary(biz.bannerUrl);
    
    let gallery = [];
    try { gallery = JSON.parse(biz.gallery || '[]'); } catch { gallery = []; }
    for (const url of gallery) {
      await deleteFromCloudinary(url);
    }

    // 6. Finalmente eliminar el negocio
    await biz.destroy();
    res.json({ message: 'Negocio y todos sus datos eliminados correctamente' });
  } catch (e) {
    console.error('Error eliminando negocio:', e);
    res.status(400).json({ error: e.message });
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
    
    // La URL de Cloudinary viene en req.file.path
    const paymentScreenshot = req.file.path;
    
    // ELIMINAR EL COMPROBANTE ANTERIOR DE CLOUDINARY SI EXISTE
    if (b.paymentScreenshot && b.paymentScreenshot !== paymentScreenshot) {
      await deleteFromCloudinary(b.paymentScreenshot);
    }
    
    // Al subir comprobante, el estado pasa a pending y si estaba bloqueado por falta de pago, se mantiene bloqueado
    // hasta que el SuperAdmin lo apruebe, O puedes decidir desbloquearlo automáticamente aquí.
    // Según tu solicitud: "se debe bloquear automáticamente hasta que se envie" implica que el envío es el disparador.
    // Vamos a desbloquearlo automáticamente al enviar el comprobante para mejorar la experiencia de usuario.
    
    await b.update({ 
      paymentScreenshot, 
      paymentScreenshotViewed: false, // Resetear flag para que el SuperAdmin vea el aviso
      subscriptionStatus: 'pending',
      status: 'active' // Desbloqueo automático al enviar comprobante
    });
    
    res.json({ message: 'Comprobante subido correctamente y negocio activado', business: b });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.markScreenshotViewed = async (req, res) => {
  try {
    const b = await Business.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    await b.update({ paymentScreenshotViewed: true });
    res.json({ message: 'Comprobante marcado como visto', business: b });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// NUEVO: Aprobar pago automáticamente (superadmin)
exports.approvePayment = async (req, res) => {
  try {
    const b = await Business.findByPk(req.params.id, {
      include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'email'] }]
    });
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Calcular fechas: hoy hasta dentro de 30 días
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30);

    await b.update({
      subscriptionStatus: 'paid',
      subscriptionStartDate: today,
      subscriptionEndDate: endDate,
      lastPaymentDate: today,
      paymentScreenshotViewed: true,
      status: 'active'
    });

    // Enviar email de confirmación al negocio
    try {
      await sendEmail(
        b.Owner?.email,
        'paymentConfirmed',
        {
          businessName: String(b.name || ''),
          ownerName: String(b.Owner?.name || 'Estimado cliente'),
          startDate: String(today.toLocaleDateString('es-CO')),
          endDate: String(endDate.toLocaleDateString('es-CO')),
          amount: String(b.paymentAmount || 60000),
        }
      );
    } catch (emailErr) {
      console.log('[Payment] Email no enviado:', emailErr.message);
    }

    res.json({ 
      message: 'Pago aprobado correctamente', 
      business: b,
      subscriptionStartDate: today,
      subscriptionEndDate: endDate
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// NUEVO: Enviar pago con detalles y notificar al admin
exports.submitPayment = async (req, res) => {
  try {
    const b = await Business.findOne({ 
      where: { ownerId: req.user.id },
      include: [{ model: User, as: 'Owner', attributes: ['id', 'name', 'email'] }]
    });
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const { 
      paymentAmount, 
      paymentMethod, 
      paymentReference,
      adminNequiNumber,
      adminLlaveBancaria,
      adminBankName,
      adminAccountNumber
    } = req.body;

    // Validaciones
    if (!paymentAmount || !paymentMethod) {
      return res.status(400).json({ error: 'Monto y método de pago son requeridos' });
    }

    // Si hay archivo (screenshot), procesarlo
    let paymentScreenshot = null;
    if (req.file) {
      paymentScreenshot = req.file.path;
      // Eliminar comprobante anterior si existe
      if (b.paymentScreenshot && b.paymentScreenshot !== paymentScreenshot) {
        await deleteFromCloudinary(b.paymentScreenshot);
      }
    }

    // Actualizar negocio con datos de pago
    await b.update({
      paymentAmount,
      paymentMethod,
      paymentReference: paymentReference || null,
      paymentScreenshot,
      paymentScreenshotViewed: false,
      lastPaymentDate: new Date(),
      subscriptionStatus: 'pending',
      adminNequiNumber: adminNequiNumber || b.adminNequiNumber,
      adminLlaveBancaria: adminLlaveBancaria || b.adminLlaveBancaria,
      adminBankName: adminBankName || b.adminBankName,
      adminAccountNumber: adminAccountNumber || b.adminAccountNumber,
      status: 'active' // Mantener activo mientras se verifica
    });

    // Enviar notificación al admin del sistema
    const adminEmail = process.env.ADMIN_EMAIL || 'notificaciones@k-dice.com';
    try {
      await sendEmail(
        adminEmail,
        'newPaymentNotification',
        {
          businessName: String(b.name || ''),
          ownerName: String(b.Owner?.name || 'Sin nombre'),
          ownerEmail: String(b.Owner?.email || 'Sin email'),
          amount: String(paymentAmount || ''),
          paymentMethod: String(paymentMethod || ''),
          paymentReference: String(paymentReference || 'N/A'),
          nequiNumber: String(adminNequiNumber || ''),
          llaveBancaria: String(adminLlaveBancaria || ''),
          bankName: String(adminBankName || ''),
          accountNumber: String(adminAccountNumber || ''),
          paymentDate: String(new Date()),
        }
      );
      console.log(`[Payment] ✅ Notificación enviada a admin para pago de ${b.name}`);
    } catch (emailError) {
      console.error('[Payment] ❌ Error enviando notificación:', emailError.message);
      // No fallar si el email falla
    }

    res.json({ 
      message: 'Pago registrado correctamente. Está pendiente de verificación.', 
      business: b 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Actualizar misión y visión
exports.updateMissionVision = async (req, res) => {
  try {
    const { id } = req.params;
    const { mission, vision, showMissionVision } = req.body;
    
    const business = await Business.findByPk(id);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    // Verificar que el usuario tenga permiso
    const isOwner = business.ownerId === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'No autorizado' });
    
    await business.update({
      mission: mission !== undefined ? mission : business.mission,
      vision: vision !== undefined ? vision : business.vision,
      showMissionVision: showMissionVision !== undefined ? showMissionVision : business.showMissionVision
    });
    
    res.json({ 
      message: 'Misión y visión actualizadas correctamente', 
      business 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Crear una reseña para el negocio (público)
exports.createReview = async (req, res) => {
  try {
    const { BusinessReview } = require('../models');
    const { slug } = req.params;
    const { clientName, rating, comment } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'La calificación debe estar entre 1 y 5 estrellas' });
    }
    
    // Buscar el negocio por slug
    const business = await Business.findOne({ where: { slug } });
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const review = await BusinessReview.create({
      businessId: business.id,
      clientName: clientName || 'Cliente Anónimo',
      rating,
      comment: comment || null,
      isApproved: true // Por defecto aprobadas, el admin puede desactivarlas luego
    });
    
    res.status(201).json({
      message: 'Reseña creada exitosamente',
      review
    });
  } catch (e) {
    console.error('[createReview] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// Obtener reseñas del negocio (para admin)
exports.getReviews = async (req, res) => {
  try {
    const { BusinessReview } = require('../models');
    const { businessId } = req.query;
    
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    
    const reviews = await BusinessReview.findAll({
      where: { businessId },
      order: [['createdAt', 'DESC']]
    });
    
    res.json(reviews);
  } catch (e) {
    console.error('[getReviews] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// Aprobar/desaprobar reseña
exports.toggleReviewApproval = async (req, res) => {
  try {
    const { BusinessReview } = require('../models');
    const { reviewId } = req.params;
    
    const review = await BusinessReview.findByPk(reviewId);
    if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
    
    // Verificar que el usuario sea admin del negocio
    const business = await Business.findByPk(review.businessId);
    const isOwner = business.ownerId === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'No autorizado' });
    
    review.isApproved = !review.isApproved;
    await review.save();
    
    res.json({
      message: `Reseña ${review.isApproved ? 'aprobada' : 'desaprobada'}`,
      review
    });
  } catch (e) {
    console.error('[toggleReviewApproval] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// Eliminar reseña
exports.deleteReview = async (req, res) => {
  try {
    const { BusinessReview } = require('../models');
    const { reviewId } = req.params;
    
    const review = await BusinessReview.findByPk(reviewId);
    if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
    
    // Verificar que el usuario sea admin del negocio
    const business = await Business.findByPk(review.businessId);
    const isOwner = business.ownerId === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'No autorizado' });
    
    await review.destroy();
    
    res.json({ message: 'Reseña eliminada' });
  } catch (e) {
    console.error('[deleteReview] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
