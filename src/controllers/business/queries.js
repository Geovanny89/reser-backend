/**
 * Controladores de consulta para negocios
 */
const { Business, Service, Employee, User, Promotion, ServiceGroup } = require('../../models');
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
    const tBiz1 = Date.now();
    console.log(`[PERF getBySlug] Business.findOne=${tBiz1 - tBiz0}ms slug=${req.params.slug}`);
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Paralelizar consultas de promociones y reviews para mejor rendimiento
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    const tPR0 = Date.now();
    const [promotions, reviews] = await Promise.all([
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
      })
    ]);
    const tPR1 = Date.now();
    console.log(`[PERF getBySlug] Promotions+Reviews=${tPR1 - tPR0}ms promos=${promotions.length} reviews=${reviews.length}`);
    
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
    const duration = service ? service.durationMin : 60;

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
      }
    });

    // Helpers
    const toMinutes = (timeStr) => {
      if (!timeStr) return 0;
      const cleanTime = String(timeStr).trim();
      const [h, m] = cleanTime.split(':').map(Number);
      return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
    };

    const dateToMinutesColombia = (date) => {
      const d = new Date(date);
      // Get time components in Colombia timezone directly
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

      const empAppointments = dayAppointments.filter(a => String(a.employeeId) === String(emp.id));

      const empSpecialSchedules = allSpecialSchedules.filter(s => 
        s.employeeId === null || String(s.employeeId) === String(emp.id)
      );

      let workSchedules = [];
      let lunchRanges = [];
      let blockedRanges = [];

      if (empSpecialSchedules.length > 0) {
        const closedSchedule = empSpecialSchedules.find(s => s.type === 'closed');
        if (closedSchedule) continue;

        workSchedules = empSpecialSchedules.filter(s => s.type === 'work');
        lunchRanges = empSpecialSchedules.filter(s => s.type === 'lunch');
        blockedRanges = empSpecialSchedules.filter(s => s.type === 'blocked');
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

        while (current + safeDuration <= workEnd) {
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

          // 2. Verificar citas existentes
          const conflictAppt = empAppointments.find(appt => {
            const apptS = dateToMinutesColombia(appt.startTime);
            const apptE = dateToMinutesColombia(appt.endTime);
            return overlaps(current, current + safeDuration, apptS, apptE);
          });

          if (conflictAppt) {
            // Saltar exactamente al final de la cita - el siguiente slot inicia cuando termina esta
            current = dateToMinutesColombia(conflictAppt.endTime);
            continue;
          }

          // 3. Verificar almuerzo y bloqueos
          const conflictBlock = [...lunchRanges, ...blockedRanges].find(r => 
            overlaps(current, current + safeDuration, toMinutes(r.startTime), toMinutes(r.endTime))
          );

          if (conflictBlock) {
            const blockEnd = toMinutes(conflictBlock.endTime);
            if (blockEnd >= workEnd) break;
            // Saltar exactamente al final del bloqueo
            current = blockEnd;
            continue;
          }

          // 4. Slot libre
          slots.push({
            employeeId: emp.id,
            employeeName: emp.User.name,
            startTime: slotStart,
            endTime: slotEnd,
            localTime: timeStr,
          });

          current += SLOT_INTERVAL;
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
