/**
 * Controladores de consulta para negocios
 */
const { Business, Service, Employee, User, Promotion, ServiceGroup, AppointmentEmployee, sequelize } = require('../../models');
const { Op } = require('sequelize');
const { buildBusinessInclude } = require('./utils');
const { SUBSCRIPTION_PLANS, ADDITIONAL_USER_PRICE } = require('./constants');
const cacheService = require('../../services/cacheService');

// GET /businesses
exports.getAll = async (req, res) => {
  try {
    const businesses = await Business.findAll({
      include: [
        { model: User, as: 'Owner', attributes: ['id', 'name', 'email'] },
        { model: Business, as: 'ParentBusiness', attributes: ['id', 'name', 'whatsapp', 'hasFieldTechnicians'] }
      ],
      order: [['createdAt', 'DESC']]
    });
    console.log(`[Business.getAll] Encontrados ${businesses.length} negocios`);
    res.json(businesses);
  } catch (e) {
    console.error('❌ [Business.getAll] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// GET /businesses/my/business
exports.getMyBusiness = async (req, res) => {
  try {
    const userId = req.user.id;
    const { businessId } = req.query;
    
    let biz = null;

    // 1. Si se solicita un negocio específico
    if (businessId) {
      biz = await Business.findByPk(businessId, {
        include: buildBusinessInclude(Service, Employee, User, Business)
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
        include: buildBusinessInclude(Service, Employee, User, Business),
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
            include: buildBusinessInclude(Service, Employee, User, Business)
          });
        }
      }
    }

    if (!biz) return res.status(404).json({ error: 'No tienes un negocio registrado o asignado' });
    
    // Agregar parentHasFieldTechnicians como campo calculado
    const bizData = biz.toJSON();
    if (bizData.isBranch && bizData.ParentBusiness) {
      bizData.parentHasFieldTechnicians = bizData.ParentBusiness.hasFieldTechnicians;
    }
    
    // Calcular días restantes de suscripción
    if (bizData.subscriptionEndDate) {
      const now = new Date();
      const endDate = new Date(bizData.subscriptionEndDate);
      const diffTime = endDate - now;
      bizData.subscriptionDaysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    } else {
      bizData.subscriptionDaysLeft = null;
    }
    
    res.json(bizData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// GET /businesses/:slug/public
exports.getBySlug = async (req, res) => {
  const t0 = Date.now();
  try {
    const { BusinessReview } = require('../../models');
    const cacheKey = `business_public_${req.params.slug}`;
    
    // Intentar obtener del caché primero
    const cached = cacheService.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] getBySlug - ${cacheKey} (${Date.now() - t0}ms)`);
      return res.json(cached);
    }
    
    console.log(`[CACHE MISS] getBySlug - ${cacheKey}`);

    const tBiz0 = Date.now();
    const biz = await Business.findOne({
      where: { slug: req.params.slug },
      include: [
        { 
          model: Service, 
          as: 'Services', 
          where: { active: true }, 
          required: false,
          separate: true,
          attributes: ['id', 'name', 'description', 'price', 'durationMin', 'isTechnicalService', 'priceOptional', 'imageUrl', 'serviceGroupId']
        },
        {
          model: ServiceGroup,
          as: 'ServiceGroups',
          where: { active: true },
          required: false,
          separate: true,
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
          separate: true,
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
    const tBiz1 = Date.now();
    console.log(`[PERF getBySlug] Business.findOne=${tBiz1 - tBiz0}ms slug=${req.params.slug}`);
    
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    // Verificar si el negocio está bloqueado
    if (biz.status === 'blocked') {
      return res.status(403).json({ error: 'Este negocio se encuentra temporalmente suspendido' });
    }

    // Paralelizar consultas de promociones y reviews para mejor rendimiento
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    const tPR0 = Date.now();
    const [promotions, reviews, reviewStats] = await Promise.all([
      Promotion.findAll({
        where: {
          businessId: biz.id,
          active: true,
          startDate: { [Op.lte]: today },
          endDate: { [Op.gte]: today }
        },
        include: [{ model: Service, attributes: ['id', 'name'] }],
        limit: 50,
        order: [['createdAt', 'DESC']]
      }),
      BusinessReview.findAll({
        where: { 
          businessId: biz.id,
          isApproved: true 
        },
        order: [['createdAt', 'DESC']],
        limit: 10
      }),
      BusinessReview.findOne({
        where: { businessId: biz.id, isApproved: true },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
          [sequelize.fn('AVG', sequelize.col('rating')), 'average']
        ],
        raw: true
      })
    ]);
    const tPR1 = Date.now();
    console.log(`[PERF getBySlug] Promos+Reviews+Stats=${tPR1 - tPR0}ms promos=${promotions.length} reviews=${reviews.length} total=${reviewStats?.total || 0}`);
    
    console.log(`[DEBUG getBySlug] Promociones encontradas: ${promotions.length}`);

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
    
    // Mapear businessHours a schedule para compatibilidad con el frontend
    bizJson.schedule = bizJson.businessHours;
    
    bizJson.Promotions = promotions;
    bizJson.Reviews = reviews;
    
    console.log(`[DEBUG getBySlug] Asignado bizJson.Promotions:`, bizJson.Promotions?.length || 0);
    console.log(`[DEBUG getBySlug] bizJson.Promotions tipo:`, typeof bizJson.Promotions, Array.isArray(bizJson.Promotions));
    
    // Calcular estadísticas de reseñas reales
    const totalReviews = parseInt(reviewStats?.total) || 0;
    const avgRating = reviewStats?.average ? parseFloat(reviewStats.average).toFixed(1) : null;
    
    bizJson.ReviewStats = {
      avgRating: avgRating ? parseFloat(avgRating) : null,
      totalReviews
    };
    
    // Asignar promociones a los servicios
    const promotionsPlain = promotions.map(p => p.toJSON());
    
    if (bizJson.Services) {
      bizJson.Services = bizJson.Services.map(svc => {
        const svcPromos = promotionsPlain.filter(p => p.serviceId === svc.id || p.applyToAllServices);
        return { ...svc, Promotions: svcPromos };
      });
    }
    
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

    // Guardar en caché por 5 minutos
    cacheService.set(cacheKey, bizJson, 5 * 60 * 1000);
    
    console.log(`[PERF getBySlug] total=${Date.now() - t0}ms slug=${req.params.slug}`);
    res.json(bizJson);
  } catch (e) {
    console.error('[getBySlug] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// GET /businesses/by-id/:id/public
exports.getByIdPublic = async (req, res) => {
  try {
    const biz = await Business.findByPk(req.params.id, {
      attributes: [
        'id', 'name', 'slug', 'type', 'description', 'phone', 'address', 
        'logoUrl', 'bannerUrl', 'primaryColor', 'secondaryColor', 
        'whatsapp', 'whatsappCatalog', 'instagram', 'facebook', 'tiktok', 'twitter', 'website', 
        'status', 'showMissionVision', 'mission', 'vision', 'googleMapsUrl',
        'isTechnicalServices', 'hasFieldTechnicians', 'businessHours'
      ]
    });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    if (biz.status === 'blocked') return res.status(403).json({ error: 'Negocio bloqueado' });
    
    const bizJson = biz.toJSON();
    // Mapear businessHours a schedule para compatibilidad con el frontend
    bizJson.schedule = bizJson.businessHours;
    res.json(bizJson);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// GET /businesses/:slug/availability
exports.getAvailability = async (req, res) => {
  try {
    const { date, serviceId } = req.query;
    if (!date) return res.status(400).json({ error: 'El parámetro date es requerido' });

    const { Appointment, Schedule, SpecialSchedule, EmployeeVacation, sequelize } = require('../../models');
    const { Op } = require('sequelize');
    const { getDayOfWeekColombia, colombiaDateFromString, colombiaDateTimeToUTC, COLOMBIA_OFFSET_MS } = require('./utils');

    const biz = await Business.findOne({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Calcular día de la semana en Colombia
    const dayOfWeek = getDayOfWeekColombia(date);

    const employees = await Employee.findAll({
      where: { businessId: biz.id, active: true },
      include: [{ model: User, attributes: ['id', 'name'] }]
    });

    const service = serviceId ? await Service.findByPk(serviceId) : null;
    const duration = req.query.duration ? parseInt(req.query.duration) : (service ? service.durationMin : 60);

    // Hora actual en Colombia
    const nowColombia = new Date(new Date().getTime() + COLOMBIA_OFFSET_MS);
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const isTargetToday = date === todayStr;

    // Verificar horarios especiales
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

    // Obtener horarios regulares
    const allRegularSchedules = await Schedule.findAll({
      where: { businessId: biz.id, dayOfWeek, active: true }
    });

    // Obtener citas del día
    const startOfDay = colombiaDateFromString(date);
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    const dayAppointments = await Appointment.findAll({
      where: {
        businessId: biz.id,
        status: { [Op.notIn]: ['cancelled'] },
        startTime: { [Op.lt]: endOfDay },
        endTime: { [Op.gt]: startOfDay }
      },
      include: [
        { model: AppointmentEmployee, as: 'AdditionalEmployees', required: false }
      ]
    });

    // Cache de duraciones de servicio base para reconstruir tramos
    const serviceDurationCache = new Map();
    if (service) {
      serviceDurationCache.set(String(service.id), parseInt(service.durationMin) || 0);
    }
    const uniqueSvcIds = [...new Set(dayAppointments.map(a => a.serviceId).filter(Boolean))];
    if (uniqueSvcIds.length > 0) {
      const svcs = await Service.findAll({
        where: { id: { [Op.in]: uniqueSvcIds } },
        attributes: ['id', 'durationMin']
      });
      svcs.forEach(s => serviceDurationCache.set(String(s.id), parseInt(s.durationMin) || 0));
    }

    // Helpers (definir antes de usar en getEmployeeBusyMinuteRanges)
    const toMinutes = (timeStr) => {
      if (!timeStr) return 0;
      const cleanTime = String(timeStr).trim();
      const [h, m] = cleanTime.split(':').map(Number);
      return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
    };

    const dateToMinutesColombia = (date) => {
      const d = new Date(date);
      const timeStr = d.toLocaleTimeString('en-US', { 
        timeZone: 'America/Bogota', 
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };

    const overlaps = (slotStart, slotEnd, blockStart, blockEnd) => {
      return slotStart < blockEnd && slotEnd > blockStart;
    };

    const appointmentInvolvesEmployee = (appt, empId) => {
      const id = String(empId);
      if (String(appt.employeeId) === id) return true;
      if (Array.isArray(appt.AdditionalEmployees) &&
          appt.AdditionalEmployees.some(ae => String(ae.employeeId) === id)) {
        return true;
      }
      const extras = Array.isArray(appt.extraServices) ? appt.extraServices : [];
      return extras.some(es => es?.employeeId != null && String(es.employeeId) === id);
    };

    /** Minutos ocupados del empleado en una cita (tramos secuenciales base + extras) */
    const getEmployeeBusyMinuteRanges = (appt, empId) => {
      const principalEmpId = String(appt.employeeId);
      const targetEmp = String(empId);
      const isPrincipal = principalEmpId === targetEmp;
      const baseDuration = serviceDurationCache.get(String(appt.serviceId));
      const extras = Array.isArray(appt.extraServices) ? appt.extraServices : [];

      if (baseDuration == null || baseDuration < 0 || isNaN(baseDuration)) {
        if (!isPrincipal) return [];
        return [{
          start: dateToMinutesColombia(appt.startTime),
          end: dateToMinutesColombia(appt.endTime)
        }];
      }

      const ranges = [];
      let cursorMs = new Date(appt.startTime).getTime();
      const pushIfMine = (blockEmpId, startMs, endMs) => {
        if (String(blockEmpId) !== targetEmp) return;
        ranges.push({
          start: dateToMinutesColombia(new Date(startMs)),
          end: dateToMinutesColombia(new Date(endMs))
        });
      };

      const baseEndMs = cursorMs + baseDuration * 60000;
      pushIfMine(principalEmpId, cursorMs, baseEndMs);
      cursorMs = baseEndMs;

      extras.forEach((es) => {
        const d = parseInt(es.durationMin) || 0;
        const blockStart = cursorMs;
        const blockEnd = cursorMs + d * 60000;
        const empForExtra = es.employeeId && String(es.employeeId) !== principalEmpId
          ? String(es.employeeId)
          : principalEmpId;
        pushIfMine(empForExtra, blockStart, blockEnd);
        cursorMs = blockEnd;
      });

      return ranges;
    };

    const slots = [];
    const nowMs = Date.now();
    const MARGIN_MS = 5 * 60 * 1000;

    for (const emp of employees) {
      // Verificar vacaciones
      const isOnVacation = await EmployeeVacation.count({
        where: {
          employeeId: emp.id,
          active: true,
          startDate: { [Op.lte]: date },
          endDate: { [Op.gte]: date }
        }
      });

      if (isOnVacation > 0) continue;

      const empAppointments = dayAppointments.filter(a => appointmentInvolvesEmployee(a, emp.id));
      const empBusyRanges = empAppointments.flatMap(a => getEmployeeBusyMinuteRanges(a, emp.id));

      const empSpecialSchedules = allSpecialSchedules.filter(s => 
        s.employeeId === null || String(s.employeeId) === String(emp.id)
      );

      let workSchedules = [];
      let lunchRanges = [];
      let blockedRanges = [];

      if (empSpecialSchedules.length > 0) {
        const closedSchedule = empSpecialSchedules.find(s => s.type === 'closed');
        if (closedSchedule) continue;

        const specialWork = empSpecialSchedules.filter(s => s.type === 'work');
        const specialLunch = empSpecialSchedules.filter(s => s.type === 'lunch');
        const specialBlocked = empSpecialSchedules.filter(s => s.type === 'blocked');

        const empSchedules = allRegularSchedules.filter(s => String(s.employeeId) === String(emp.id));
        const regularWork = empSchedules.filter(s => (s.type || 'work').trim().toLowerCase() === 'work');
        const regularLunch = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch');
        const regularBlocked = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked');

        // Work especial (festivo) si existe; si no, work regular
        workSchedules = specialWork.length > 0 ? specialWork : regularWork;
        // Descansos del festivo + descansos regulares del empleado
        lunchRanges = [...specialLunch, ...regularLunch];
        blockedRanges = [...specialBlocked, ...regularBlocked];
      } else {
        const empSchedules = allRegularSchedules.filter(s => String(s.employeeId) === String(emp.id));
        workSchedules = empSchedules.filter(s => (s.type || 'work').trim().toLowerCase() === 'work');
        lunchRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch');
        blockedRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked');
      }

      const SLOT_INTERVAL = 15; // Intervalo fijo de 15 minutos para slots

      for (const sched of workSchedules) {
        const workStart = toMinutes(sched.startTime);
        const workEnd = toMinutes(sched.endTime);
        let current = workStart;
        const safeDuration = (duration && duration > 0) ? Number(duration) : 30;

        while (current < workEnd) {
          // No ofrecer la hora exacta de cierre como inicio
          if (current >= workEnd) break;

          const hh = String(Math.floor(current / 60)).padStart(2, '0');
          const mm = String(current % 60).padStart(2, '0');
          const timeStr = `${hh}:${mm}`;

          const slotStart = colombiaDateTimeToUTC(date, timeStr);
          const slotEnd = new Date(slotStart.getTime() + safeDuration * 60000);

          // 1. Filtrar si ya pasó
          if (isTargetToday && slotStart.getTime() <= (nowMs - MARGIN_MS)) {
            current += SLOT_INTERVAL;
            continue;
          }

          // 2. Verificar citas existentes (tramos reales del profesional)
          const conflictRange = empBusyRanges.find(r =>
            overlaps(current, current + safeDuration, r.start, r.end)
          );

          if (conflictRange) {
            if (conflictRange.end >= workEnd) break;
            current = conflictRange.end;
            continue;
          }

          // 3. Verificar almuerzo y bloqueos (solo dentro del horario laboral;
          //    se permite que la última cita termine después del cierre)
          const conflictBlock = [...lunchRanges, ...blockedRanges].find(r => 
            overlaps(current, Math.min(current + safeDuration, workEnd), toMinutes(r.startTime), toMinutes(r.endTime))
          );

          if (conflictBlock) {
            const blockEnd = toMinutes(conflictBlock.endTime);
            if (blockEnd >= workEnd) break;
            current = blockEnd;
            continue;
          }

          slots.push({
            employeeId: emp.id,
            employeeName: emp.User?.name || 'Profesional',
            startTime: slotStart,
            endTime: slotEnd,
            localTime: timeStr,
          });

          const next = current + SLOT_INTERVAL;
          if (next >= workEnd) break;
          current = next;
        }
      }
    }

    // Ordenar y eliminar duplicados
    slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    
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

// GET /businesses/my/branches
exports.getMyBranches = async (req, res) => {
  try {
    let parentBiz = await Business.findOne({ 
      where: { ownerId: req.user.id },
      order: [['isBranch', 'ASC']] // Primero negocios principales
    });

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

// GET /businesses/plans/available
exports.getAvailablePlans = async (req, res) => {
  try {
    const plans = Object.entries(SUBSCRIPTION_PLANS).map(([key, plan]) => ({
      id: key,
      name: plan.name,
      price: plan.price,
      includedUsers: plan.includedUsers,
      additionalUserPrice: ADDITIONAL_USER_PRICE
    }));
    
    res.json({
      plans,
      additionalUserPrice: ADDITIONAL_USER_PRICE
    });
  } catch (e) {
    console.error('[getAvailablePlans] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
