/**
 * Lógica de disponibilidad de horarios
 */

const { Appointment, Service, Employee, Business, Schedule, SpecialSchedule, EmployeeVacation, Promotion, AppointmentEmployee, Op, sequelize } = require('../../models');
const { colombiaDateFromString, getDayOfWeekColombia, COLOMBIA_OFFSET_MS, getNowColombia, getTodayStringColombia } = require('./utils');
const fs = require('fs');
const path = require('path');

const debugLog = (msg) => {
  const logFile = 'c:\\Users\\Gecaro\\Downloads\\kdice-final-v5\\availability_debug.log';
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
};

/**
 * True si el empleado es principal, está en AppointmentEmployees,
 * o aparece en extraServices[].employeeId (cubre citas antiguas sin join).
 */
function appointmentInvolvesEmployee(appt, employeeId) {
  const empId = String(employeeId);
  if (String(appt.employeeId) === empId) return true;
  if (Array.isArray(appt.AdditionalEmployees) &&
      appt.AdditionalEmployees.some(ae => String(ae.employeeId) === empId)) {
    return true;
  }
  const extras = Array.isArray(appt.extraServices) ? appt.extraServices : [];
  return extras.some(es => es?.employeeId != null && String(es.employeeId) === empId);
}

exports.getAvailability = async (req, res) => {
  try {
    const { date, employeeId, serviceId, businessId, allowPast, duration, excludeId } = req.query;
    debugLog(`[Availability Handler] Incoming: date=${date}, emp=${employeeId}, svc=${serviceId}, bus=${businessId}, past=${allowPast}, duration=${duration}, excludeId=${excludeId}`);
    const result = await getAvailability(date, employeeId, serviceId, businessId, allowPast === 'true', excludeId || null, duration);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

/**
 * Obtiene disponibilidad de horarios para una fecha, empleado y servicio
 */
async function getAvailability(date, employeeId, serviceId, businessId, allowPast = false, excludeId = null, customDuration = null) {
  debugLog(`[getAvailability Core] date=${date}, emp=${employeeId}, svc=${serviceId}, bus=${businessId}, past=${allowPast}, customDuration=${customDuration}`);
  if (!date || !employeeId || !serviceId || !businessId) {
    debugLog(`[getAvailability Core] MISSING PARAMETERS: date=${!!date}, emp=${!!employeeId}, svc=${!!serviceId}, bus=${!!businessId}`);
    return { availableSlots: [] };
  }

  const service = await Service.findByPk(serviceId);
  if (!service) throw new Error('Servicio no encontrado');

  const business = await Business.findByPk(businessId);
  if (!business) throw new Error('Negocio no encontrado');

  // Asegurar que la fecha sea solo YYYY-MM-DD para la consulta de base de datos
  const dateOnly = date.split('T')[0];

  // Verificar si el empleado está de vacaciones en esta fecha
  const vacationCount = await EmployeeVacation.count({
    where: {
      employeeId,
      active: true,
      startDate: { [Op.lte]: dateOnly },
      endDate: { [Op.gte]: dateOnly }
    }
  });

  if (vacationCount > 0) {
    console.log(`[Availability] Empleado ${employeeId} en vacaciones para la fecha ${dateOnly}`);
    return { availableSlots: [] };
  }

  // Fecha en zona horaria Colombia
  const dateObj = colombiaDateFromString(date);
  const dayOfWeek = getDayOfWeekColombia(date);

  // Verificar si hay horarios especiales para esta fecha
  const [month, dayNum] = date.split('-').slice(1);

  const specialSchedules = await SpecialSchedule.findAll({
    where: {
      businessId,
      active: true,
      [Op.and]: [
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

  // Si hay horarios especiales, usarlos
  if (specialSchedules.length > 0) {
    const closedSchedule = specialSchedules.find(s => s.type === 'closed');
    if (closedSchedule) {
      console.log(`[Availability] Fecha ${date} cerrada por horario especial.`);
      return { availableSlots: [] };
    }

    // Clasificar horarios especiales
    const empSpecial = specialSchedules.filter(s => String(s.employeeId) === String(employeeId));
    const bizSpecial = specialSchedules.filter(s => s.employeeId === null || s.employeeId === undefined);

    // Prioridad para horarios de trabajo: Empleado > Negocio
    const empWork = empSpecial.filter(s => s.type === 'work');
    const bizWork = bizSpecial.filter(s => s.type === 'work');
    workSchedules = empWork.length > 0 ? empWork : bizWork;

    lunchRanges = specialSchedules.filter(s => s.type === 'lunch');
    blockedRanges = specialSchedules.filter(s => s.type === 'blocked');

    // Horario regular del empleado (almuerzo/descansos del día de la semana)
    const regularSchedules = await Schedule.findAll({
      where: { employeeId, dayOfWeek, active: true }
    });
    const regularLunch = regularSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch');
    const regularBlocked = regularSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked');

    // Si el festivo/especial solo define trabajo (ej. 08–18), conservar descansos regulares
    lunchRanges = [...lunchRanges, ...regularLunch];
    blockedRanges = [...blockedRanges, ...regularBlocked];

    // Si no hay work especial, usar el work regular
    if (workSchedules.length === 0) {
      workSchedules = regularSchedules.filter(s => (s.type || 'work').trim().toLowerCase() === 'work');
    }

    console.log(`[Availability] Usando horarios especiales para ${date}. Work: ${workSchedules.length}, Blocked: ${blockedRanges.length}, Lunch: ${lunchRanges.length}`);
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

    debugLog(`[Availability] Usando horarios regulares para ${date} (Día ${dayOfWeek}). Work: ${workSchedules.length}`);
  }

  if (workSchedules.length === 0) {
    debugLog(`[Availability] No se encontraron horarios de trabajo para ${date}.`);
    return { availableSlots: [] };
  }

  // Obtener citas existentes (usando fechas con offset Colombia explícito)
  const startOfDay = new Date(`${date}T00:00:00-05:00`);
  const endOfDay = new Date(`${date}T23:59:59.999-05:00`);

  const whereCondition = {
    businessId,
    status: { [Op.notIn]: ['cancelled'] },
    startTime: { [Op.lt]: endOfDay },
    endTime: { [Op.gt]: startOfDay },
  };

  if (excludeId) {
    whereCondition.id = { [Op.ne]: excludeId };
  }

  // Cargar citas del día y filtrar por involucramiento real del empleado
  // (principal, AppointmentEmployees, o extraServices[].employeeId)
  const dayAppointments = await Appointment.findAll({
    where: whereCondition,
    include: [
      { model: AppointmentEmployee, as: 'AdditionalEmployees', required: false }
    ],
    subQuery: false
  });

  const existingAppointments = dayAppointments.filter(a => appointmentInvolvesEmployee(a, employeeId));

  console.log(`[Availability] Citas existentes (no canceladas, como principal o adicional): ${existingAppointments.length}`,
    existingAppointments.map(a => ({ id: a.id, status: a.status, start: a.startTime, end: a.endTime }))
  );

  // Cache de Services para consultar una sola vez por ID (evita N+1)
  const serviceCache = new Map();
  const fetchServiceCached = async (svcId) => {
    if (!svcId) return null;
    const key = String(svcId);
    if (serviceCache.has(key)) return serviceCache.get(key);
    try {
      const s = await Service.findByPk(svcId, { attributes: ['id', 'durationMin'] });
      serviceCache.set(key, s || null);
      return s;
    } catch (e) {
      serviceCache.set(key, null);
      return null;
    }
  };

  // Precargar todos los Service necesarios en una sola consulta (más eficiente)
  try {
    const uniqueSvcIds = [...new Set(existingAppointments.map(a => a.serviceId).filter(Boolean))];
    if (uniqueSvcIds.length > 0) {
      const svcs = await Service.findAll({
        where: { id: { [Op.in]: uniqueSvcIds } },
        attributes: ['id', 'durationMin']
      });
      svcs.forEach(s => serviceCache.set(String(s.id), s));
    }
  } catch (e) {
    console.error('[Availability] Error precargando servicios, continuaré individual:', e.message);
  }

  // ========== CALCULAR TRAMOS REALES DEL EMPLEADO EN CADA CITA ==========
  const employeeBusyRanges = []; // [{start, end, appointmentId}]
  for (const appt of existingAppointments) {
    try {
      const apptStartMs = new Date(appt.startTime).getTime();
      const extrasRaw = appt.extraServices || [];
      const extras = Array.isArray(extrasRaw) ? extrasRaw : [];

      // Obtener el servicio de la cita (cache)
      const apptService = serviceCache.get(String(appt.serviceId)) || null;

      const baseDuration = (() => {
        const raw1 = apptService?.durationMin;
        if (raw1 !== undefined && raw1 !== null && !isNaN(parseInt(raw1))) return parseInt(raw1);
        return null;
      })();

      const principalEmpId = String(appt.employeeId);
      const isPrincipal = String(employeeId) === principalEmpId;

      if (baseDuration === null || baseDuration < 0 || isNaN(baseDuration)) {
        // FALLBACK por falta de datos del servicio.
        // - Si es el profesional PRINCIPAL → bloquear TODO el rango (seguro, es el dueño de la cita).
        // - Si es un profesional ADICIONAL → NO bloquear nada.
        //   No podemos saber en qué tramo exacto está asignado, y bloquear 4h por un extra de 1h
        //   es mucho peor que permitir una posible sobrescritura (create.js validará de nuevo).
        console.log(`[Availability] Cita ${appt.id} sin servicio/duración. ` +
          `Empleado ${employeeId} ${isPrincipal ? 'ES PRINCIPAL → bloquear rango completo' : 'es adicional → NO bloquear'}`);
        if (isPrincipal) {
          employeeBusyRanges.push({
            start: new Date(appt.startTime),
            end: new Date(appt.endTime),
            appointmentId: appt.id
          });
        }
        continue;
      }

      const blocks = [];
      let cursor = apptStartMs;

      // Bloque 0: servicio base
      const baseEnd = cursor + baseDuration * 60000;
      blocks.push({
        employeeId: principalEmpId,
        start: new Date(cursor),
        end: new Date(baseEnd),
      });
      cursor = baseEnd;

      // Bloques extras secuenciales
      extras.forEach((es, i) => {
        const d = parseInt(es.durationMin) || 0;
        const blockStart = cursor;
        const blockEnd = cursor + d * 60000;
        const empForExtra = es.employeeId && String(es.employeeId) !== principalEmpId
          ? String(es.employeeId)
          : principalEmpId;
        blocks.push({
          employeeId: empForExtra,
          start: new Date(blockStart),
          end: new Date(blockEnd),
          meta: `extra[${i}] name=${es.name || '?'} dur=${d}min empId=${es.employeeId || 'NULL'} → assignedEmp=${empForExtra}`
        });
        cursor = blockEnd;
      });

      // ==== LOG DETALLADO POR CITA ====
      console.log(`[Availability-DBG] Cita ${appt.id} Principal=${principalEmpId} ConsultandoEmp=${employeeId}`);
      console.log(`  baseDuration=${baseDuration}min, extras=${extras.length}`);
      blocks.forEach((b, i) => {
        const sTime = new Date(b.start).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
        const eTime = new Date(b.end).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
        console.log(`  block[${i}] emp=${b.employeeId} [${sTime}-${eTime}] ${b.meta || 'SERVICIO BASE'}`);
      });

      // Filtrar solo los bloques de ESTE empleado
      const myBlocks = blocks.filter(b => String(b.employeeId) === String(employeeId));

      console.log(`  → Bloques para empleado ${employeeId}: ${myBlocks.length}`);

      if (myBlocks.length === 0) {
        // Importante: si ESTE empleado NO tiene bloques propios en la cita,
        // significa que NO está ocupado en ella (por ejemplo, aparece como
        // empleado adicional en la BD pero todos los extras tienen otro profesional).
        // => NO agregamos nada a employeeBusyRanges.
        continue;
      }

      // Fusionar bloques contiguos (por si acaso)
      myBlocks.sort((a, b) => a.start.getTime() - b.start.getTime());
      let merged = { start: myBlocks[0].start, end: myBlocks[0].end };
      for (let i = 1; i < myBlocks.length; i++) {
        if (myBlocks[i].start.getTime() <= merged.end.getTime() + 1000) {
          merged.end = myBlocks[i].end > merged.end ? myBlocks[i].end : merged.end;
        } else {
          employeeBusyRanges.push({ ...merged, appointmentId: appt.id });
          merged = { start: myBlocks[i].start, end: myBlocks[i].end };
        }
      }
      employeeBusyRanges.push({ ...merged, appointmentId: appt.id });
    } catch (err) {
      console.error('[Availability] Error calculando bloques para cita', appt.id, '→ fallback inteligente. Err:', err.message);
      const isPrincipalCatch = String(employeeId) === String(appt.employeeId);
      if (isPrincipalCatch) {
        employeeBusyRanges.push({
          start: new Date(appt.startTime),
          end: new Date(appt.endTime),
          appointmentId: appt.id
        });
      } else {
        console.log('[Availability] Empleado adicional ' + employeeId + ' → NO bloqueado por seguridad.');
      }
    }
  }
  console.log(`[Availability] Tramos de ocupación REAL para empleado ${employeeId}:`, employeeBusyRanges.map(r => ({
    id: r.appointmentId,
    start: r.start.toISOString(),
    end: r.end.toISOString()
  })));

  // Generar slots disponibles
  const duration = customDuration ? parseInt(customDuration) : (service.durationMin || 30);
  console.log(`[Availability] Duración servicio: ${duration}min, allowPast: ${allowPast}`);

  debugLog(`[Availability Debug] Starting for date: ${date}, emp: ${employeeId}, svc: ${serviceId}`);

  const slots = generateAvailableSlots(
    workSchedules,
    lunchRanges,
    blockedRanges,
    employeeBusyRanges,
    duration,
    date,
    allowPast
  );

  debugLog(`[Availability Debug] Generated ${slots.length} slots for ${date}`);
  if (slots.length === 0) {
    debugLog(`[Availability Debug] REASONS FOR ZERO SLOTS:
      workSchedules: ${workSchedules.length}
      lunchRanges: ${lunchRanges.length}
      blockedRanges: ${blockedRanges.length}
      existingAppointments: ${existingAppointments.length}
      duration: ${duration}
      allowPast: ${allowPast}
      currentNowColombia: ${getNowColombia().toISOString()}
    `);
  }

  // Verificar promociones
  const today = getTodayStringColombia();
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
    }
  });

  return {
    date,
    dayOfWeek,
    isOpen: true,
    serviceDuration: duration,
    availableSlots: slots,
    hasPromotion: !!promotion,
    promotion: promotion ? {
      discountType: promotion.discountType,
      discountValue: promotion.discountValue
    } : null
  };
}

function generateAvailableSlots(workSchedules, lunchRanges, blockedRanges, employeeBusyRanges, duration, date, allowPast) {
  if (!workSchedules || workSchedules.length === 0) return [];

  const slots = [];
  const safeDuration = (duration && duration > 0) ? Number(duration) : 30;

  const SLOT_INTERVAL = 15; // granularidad de inicio: revisa cada 15 min; el chequeo de conflictos descarta los solapados

  // ==================== HELPERS ====================

  const toMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = String(timeStr).trim().split(':').map(Number);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  };

  const dateToMinutesColombia = (dateIn) => {
    const d = new Date(dateIn);
    const timeStr = d.toLocaleTimeString('en-US', {
      timeZone: 'America/Bogota',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    });
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  const overlaps = (start1, end1, start2, end2) => {
    return start1 < end2 && end1 > start2;
  };

  const clampToRange = (val, min, max) => Math.max(min, Math.min(max, val));

  // ==================== ORDENAR HORARIOS ====================

  workSchedules.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  // ==================== GENERACIÓN ====================

  for (const sched of workSchedules) {
    const workStart = toMinutes(sched.startTime);
    const workEnd = toMinutes(sched.endTime);
    const workStartMin = Math.max(0, Math.min(24 * 60, workStart));
    const workEndMin = Math.max(workStartMin + 1, Math.min(24 * 60, workEnd));

    // Última cita: puede EMPEZAR dentro del horario aunque TERMINE después del cierre
    // (ej. horario hasta 18:00, libre 17:45 → se puede agendar un servicio de 30–40 min)
    let current = workStartMin;
    let safetyCounter = 0;
    const SAFETY_LIMIT = 1000;

    while (current < workEndMin) {
      safetyCounter++;
      if (safetyCounter > SAFETY_LIMIT) {
        console.error(`[generateAvailableSlots] Bucle sospechoso, abortando. current=${current}, schedule=${sched.startTime}-${sched.endTime}`);
        break;
      }

      // Nunca ofrecer la hora exacta de cierre como inicio (ej. 18:00)
      if (current >= workEndMin) break;

      const hh = String(Math.floor(current / 60)).padStart(2, '0');
      const mm = String(current % 60).padStart(2, '0');
      const timeStr = `${hh}:${mm}`;

      const datePart = date.split('T')[0];
      const slotTime = new Date(`${datePart}T${timeStr}:00-05:00`);
      const slotEndTime = new Date(slotTime.getTime() + safeDuration * 60000);

      // ==================== 1. VALIDAR PASADO ====================

      if (!allowPast) {
        const MARGIN_MS = 5 * 60 * 1000;
        const nowMs = Date.now();
        const slotMs = slotTime.getTime();
        if (slotMs <= (nowMs - MARGIN_MS)) {
          current = clampToRange(current + SLOT_INTERVAL, current + 1, workEndMin);
          continue;
        }
      }

      // ==================== 2. RANGOS DE OCUPACIÓN REAL DEL EMPLEADO ====================

      const conflictBusy = (employeeBusyRanges || []).find(range => {
        if (!range || !range.start || !range.end) return false;
        const rangeS = dateToMinutesColombia(range.start);
        const rangeE = dateToMinutesColombia(range.end);
        return overlaps(current, current + safeDuration, rangeS, rangeE);
      });

      if (conflictBusy) {
        const nextByConflict = dateToMinutesColombia(conflictBusy.end);
        // Si la ocupación llega al cierre o más, no hay más inicios posibles
        if (nextByConflict >= workEndMin) break;
        current = clampToRange(nextByConflict, current + 1, workEndMin);
        continue;
      }

      // ==================== 3. BLOQUEOS / ALMUERZO ====================
      // Solo dentro del horario laboral; se permite terminar después del cierre.
      const conflictBlock = [...lunchRanges, ...blockedRanges].find(r => {
        const blockStart = toMinutes(r.startTime);
        const blockEnd = toMinutes(r.endTime);
        const slotEndWithinWork = Math.min(current + safeDuration, workEndMin);
        return overlaps(current, slotEndWithinWork, blockStart, blockEnd);
      });

      if (conflictBlock) {
        const blockEnd = toMinutes(conflictBlock.endTime);
        if (blockEnd >= workEndMin) break;
        current = clampToRange(blockEnd, current + 1, workEndMin);
        continue;
      }

      // ==================== 4. SLOT VÁLIDO (inicio estrictamente antes del cierre) ====================

      slots.push({
        time: timeStr,
        startTime: slotTime.toISOString(),
        endTime: slotEndTime.toISOString()
      });

      const next = current + SLOT_INTERVAL;
      if (next >= workEndMin) break;
      current = next;
    }
  }

  // ==================== LIMPIEZA ====================

  const seen = new Set();

  return slots
    .filter(slot => {
      if (seen.has(slot.time)) return false;
      seen.add(slot.time);
      return true;
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

function formatTime(date) {
  return date.toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Valida si una hora manual específica es válida dentro del horario de trabajo
 */
async function validateManualTime(date, employeeId, serviceId, businessId, manualTime) {
  if (!date || !employeeId || !serviceId || !businessId || !manualTime) {
    throw new Error('Todos los parámetros son requeridos');
  }

  const service = await Service.findByPk(serviceId);
  if (!service) throw new Error('Servicio no encontrado');

  const business = await Business.findByPk(businessId);
  if (!business) throw new Error('Negocio no encontrado');

  // Asegurar que la fecha sea solo YYYY-MM-DD
  const dateOnly = date.split('T')[0];

  // Verificar si el empleado está de vacaciones
  const vacationCount = await EmployeeVacation.count({
    where: {
      employeeId,
      active: true,
      startDate: { [Op.lte]: dateOnly },
      endDate: { [Op.gte]: dateOnly }
    }
  });

  if (vacationCount > 0) {
    return { valid: false, reason: 'El empleado está de vacaciones en esta fecha' };
  }

  // Fecha en zona horaria Colombia
  const dateObj = colombiaDateFromString(date);
  const dayOfWeek = getDayOfWeekColombia(date);

  // Verificar horarios especiales
  const [month, dayNum] = date.split('-').slice(1);

  const specialSchedules = await SpecialSchedule.findAll({
    where: {
      businessId,
      active: true,
      [Op.and]: [
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
        {
          [Op.or]: [
            { employeeId: employeeId },
            { employeeId: null }
          ]
        }
      ]
    }
  });

  let workSchedules = [];
  let lunchRanges = [];
  let blockedRanges = [];

  if (specialSchedules.length > 0) {
    const closedSchedule = specialSchedules.find(s => s.type === 'closed');
    if (closedSchedule) {
      console.log(`[validateManualTime] Fecha ${date} cerrada por horario especial.`);
      return { valid: false, reason: 'El negocio está cerrado en esta fecha' };
    }

    // Clasificar horarios especiales
    const empSpecial = specialSchedules.filter(s => String(s.employeeId) === String(employeeId));
    const bizSpecial = specialSchedules.filter(s => s.employeeId === null || s.employeeId === undefined);

    // Prioridad para horarios de trabajo: Empleado > Negocio
    const empWork = empSpecial.filter(s => s.type === 'work');
    const bizWork = bizSpecial.filter(s => s.type === 'work');
    workSchedules = empWork.length > 0 ? empWork : bizWork;

    lunchRanges = specialSchedules.filter(s => s.type === 'lunch');
    blockedRanges = specialSchedules.filter(s => s.type === 'blocked');

    const regularSchedules = await Schedule.findAll({
      where: { employeeId, dayOfWeek, active: true }
    });
    const regularLunch = regularSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch');
    const regularBlocked = regularSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked');

    // Festivo con work especial: conservar descansos regulares del empleado
    lunchRanges = [...lunchRanges, ...regularLunch];
    blockedRanges = [...blockedRanges, ...regularBlocked];

    if (workSchedules.length === 0) {
      workSchedules = regularSchedules.filter(s => (s.type || 'work').trim().toLowerCase() === 'work');
    }
    console.log(`[validateManualTime] Usando horarios especiales para ${date}. Work: ${workSchedules.length}, Blocked: ${blockedRanges.length}, Lunch: ${lunchRanges.length}`);
  } else {
    const empSchedules = await Schedule.findAll({
      where: { employeeId, dayOfWeek, active: true }
    });

    workSchedules = empSchedules.filter(s => {
      const type = (s.type || 'work').trim().toLowerCase();
      return type === 'work';
    });

    lunchRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch');
    blockedRanges = empSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked');
    console.log(`[validateManualTime] Usando horarios regulares para ${date} (Día ${dayOfWeek}). Work: ${workSchedules.length}`);
  }

  if (workSchedules.length === 0) {
    console.log(`[validateManualTime] No se encontraron horarios de trabajo para ${date}.`);
    return { valid: false, reason: 'El empleado no tiene horarios de trabajo configurados para este día' };
  }

  // Convertir hora manual a minutos
  const toMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const cleanTime = String(timeStr).trim();
    const [h, m] = cleanTime.split(':').map(Number);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  };

  const manualMinutes = toMinutes(manualTime);
  const duration = service.durationMin || 30;
  const manualStart = manualMinutes;
  const manualEnd = manualMinutes + duration;

  console.log('[validateManualTime] DEBUG:', {
    manualTime,
    manualMinutes,
    duration,
    manualStart,
    manualEnd,
    workSchedules: workSchedules.map(s => ({
      startTime: s.startTime,
      endTime: s.endTime,
      startMin: toMinutes(s.startTime),
      endMin: toMinutes(s.endTime)
    }))
  });

  // Verificar si el INICIO está dentro del horario (antes del cierre; no a la hora exacta de fin)
  // La cita puede terminar después del cierre.
  const inWorkSchedule = workSchedules.some(sched => {
    const workStart = toMinutes(sched.startTime);
    const workEnd = toMinutes(sched.endTime);
    console.log('[validateManualTime] Checking schedule:', {
      workStart,
      workEnd,
      manualStart,
      manualEnd,
      condition: manualStart >= workStart && manualStart < workEnd
    });
    return manualStart >= workStart && manualStart < workEnd;
  });

  if (!inWorkSchedule) {
    return { valid: false, reason: 'La hora seleccionada está fuera del horario de trabajo del empleado' };
  }

  // Verificar conflicto con almuerzo o bloqueos solo dentro del horario laboral
  const workEndForSlot = (() => {
    for (const sched of workSchedules) {
      const workStart = toMinutes(sched.startTime);
      const workEnd = toMinutes(sched.endTime);
      if (manualStart >= workStart && manualStart < workEnd) return workEnd;
    }
    return manualEnd;
  })();

  const conflictBlock = [...lunchRanges, ...blockedRanges].find(r => {
    const blockStart = toMinutes(r.startTime);
    const blockEnd = toMinutes(r.endTime);
    const endWithinWork = Math.min(manualEnd, workEndForSlot);
    return manualStart < blockEnd && endWithinWork > blockStart;
  });

  if (conflictBlock) {
    return { valid: false, reason: 'La hora seleccionada coincide con un horario de almuerzo o bloqueo' };
  }

  // Verificar conflicto con citas existentes (usando TRAMOS REALES del empleado, no rango completo)
  const startOfDay = new Date(`${date}T00:00:00-05:00`);
  const endOfDay = new Date(`${date}T23:59:59.999-05:00`);

  const dayAppointments = await Appointment.findAll({
    where: {
      businessId,
      status: { [Op.notIn]: ['cancelled'] },
      startTime: { [Op.lt]: endOfDay },
      endTime: { [Op.gt]: startOfDay },
    },
    include: [
      { model: AppointmentEmployee, as: 'AdditionalEmployees', required: false }
    ],
    subQuery: false
  });

  const existingAppointments = dayAppointments.filter(a => appointmentInvolvesEmployee(a, employeeId));

  // Precargar servicios necesarios en lote
  const svcMap = new Map();
  try {
    const uniqueSvcIds = [...new Set(existingAppointments.map(a => a.serviceId).filter(Boolean))];
    if (uniqueSvcIds.length > 0) {
      const svcs = await Service.findAll({
        where: { id: { [Op.in]: uniqueSvcIds } },
        attributes: ['id', 'durationMin']
      });
      svcs.forEach(s => svcMap.set(String(s.id), s));
    }
  } catch (e) {
    console.error('[validateManualTime] Error precargando servicios:', e.message);
  }

  const slotTime = new Date(`${date}T${manualTime}:00-05:00`);
  const slotEndTime = new Date(slotTime.getTime() + duration * 60000);
  const slotS = slotTime.getTime();
  const slotE = slotEndTime.getTime();

  // Calcular tramos reales de ocupación para este empleado en cada cita
  let hasConflict = false;
  let conflictReason = '';
  for (const appt of existingAppointments) {
    try {
      const apptStartMs = new Date(appt.startTime).getTime();
      const extrasRaw = appt.extraServices || [];
      const extras = Array.isArray(extrasRaw) ? extrasRaw : [];
      const apptService = svcMap.get(String(appt.serviceId)) || null;
      const isPrincipal = String(employeeId) === String(appt.employeeId);

      const baseDuration = (() => {
        const raw1 = apptService?.durationMin;
        if (raw1 !== undefined && raw1 !== null && !isNaN(parseInt(raw1))) return parseInt(raw1);
        return null;
      })();

      const ranges = [];
      if (baseDuration === null || baseDuration < 0 || isNaN(baseDuration)) {
        // Solo el principal bloquea el rango completo si faltan datos
        if (isPrincipal) {
          ranges.push({ start: new Date(appt.startTime), end: new Date(appt.endTime) });
        }
      } else {
        const blocks = [];
        let cursor = apptStartMs;
        const principalEmpId = String(appt.employeeId);
        const baseEnd = cursor + baseDuration * 60000;
        blocks.push({ employeeId: principalEmpId, start: new Date(cursor), end: new Date(baseEnd) });
        cursor = baseEnd;
        extras.forEach((es) => {
          const d = parseInt(es.durationMin) || 0;
          const bStart = cursor;
          const bEnd = cursor + d * 60000;
          const empForExtra = es.employeeId && String(es.employeeId) !== principalEmpId
            ? String(es.employeeId)
            : principalEmpId;
          blocks.push({ employeeId: empForExtra, start: new Date(bStart), end: new Date(bEnd) });
          cursor = bEnd;
        });
        const myBlocks = blocks.filter(b => String(b.employeeId) === String(employeeId));
        ranges.push(...myBlocks.map(b => ({ start: b.start, end: b.end })));
      }

      for (const r of ranges) {
        const rS = new Date(r.start).getTime();
        const rE = new Date(r.end).getTime();
        if (slotS < (rE - 1000) && slotE > (rS + 1000)) {
          hasConflict = true;
          const t1 = new Date(rS).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
          const t2 = new Date(rE).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
          conflictReason = `El empleado está ocupado de ${t1} a ${t2} en otra cita`;
          break;
        }
      }
    } catch (err) {
      // Fallback: si hay error, bloquear el rango completo para seguridad.
      const rS = new Date(appt.startTime).getTime();
      const rE = new Date(appt.endTime).getTime();
      if (slotS < (rE - 1000) && slotE > (rS + 1000)) {
        hasConflict = true;
        const t1 = new Date(rS).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
        const t2 = new Date(rE).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
        conflictReason = `El empleado está ocupado de ${t1} a ${t2} en otra cita`;
      }
    }
    if (hasConflict) break;
  }

  if (hasConflict) {
    return { valid: false, reason: conflictReason };
  }

  // Verificar si ya pasó (con margen de 5 minutos)
  const MARGIN_MS = 5 * 60 * 1000;
  if (slotTime.getTime() <= (getNowColombia().getTime() - MARGIN_MS)) {
    return { valid: false, reason: 'La hora seleccionada ya pasó' };
  }

  return {
    valid: true,
    startTime: slotTime.toISOString(),
    endTime: slotEndTime.toISOString()
  };
}

module.exports = {
  getAvailability,
  validateManualTime
};
