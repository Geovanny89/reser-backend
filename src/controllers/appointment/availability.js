/**
 * Lógica de disponibilidad de horarios
 */

const { Appointment, Service, Employee, Business, Schedule, SpecialSchedule, EmployeeVacation, Promotion, Op, sequelize } = require('../../models');
const { colombiaDateFromString, getDayOfWeekColombia, COLOMBIA_OFFSET_MS } = require('./utils');

/**
 * Obtiene disponibilidad de horarios para una fecha, empleado y servicio
 */
async function getAvailability(date, employeeId, serviceId, businessId, allowPast = false, excludeId = null) {
  // Validar parámetros
  if (!date || !employeeId || !serviceId || !businessId) {
    throw new Error('Fecha, empleado, servicio y negocio son requeridos');
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
    const empSpecial = specialSchedules.filter(s => s.employeeId === employeeId);
    const bizSpecial = specialSchedules.filter(s => s.employeeId === null);

    // Prioridad para horarios de trabajo: Empleado > Negocio
    const empWork = empSpecial.filter(s => s.type === 'work');
    const bizWork = bizSpecial.filter(s => s.type === 'work');
    workSchedules = empWork.length > 0 ? empWork : bizWork;

    // Combinar bloqueos y almuerzos (negocio + empleado)
    lunchRanges = specialSchedules.filter(s => s.type === 'lunch');
    blockedRanges = specialSchedules.filter(s => s.type === 'blocked');

    // Si los horarios especiales no incluyen un horario de trabajo ('work'),
    // cargamos el horario regular y le agregamos estos bloqueos/almuerzos.
    if (workSchedules.length === 0) {
      const regularSchedules = await Schedule.findAll({
        where: { employeeId, dayOfWeek, active: true }
      });
      
      workSchedules = regularSchedules.filter(s => (s.type || 'work').trim().toLowerCase() === 'work');
      
      // Combinar con almuerzos y bloqueos regulares
      lunchRanges = [
        ...lunchRanges,
        ...regularSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch')
      ];
      
      blockedRanges = [
        ...blockedRanges,
        ...regularSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked')
      ];
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
    
    console.log(`[Availability] Usando horarios regulares para ${date} (Día ${dayOfWeek}). Work: ${workSchedules.length}`);
  }

  if (workSchedules.length === 0) {
    console.log(`[Availability] No se encontraron horarios de trabajo para ${date}.`);
    return { availableSlots: [] };
  }

  // Obtener citas existentes (usando fechas con offset Colombia explícito)
  const startOfDay = new Date(`${date}T00:00:00-05:00`);
  const endOfDay = new Date(`${date}T23:59:59.999-05:00`);

  const whereCondition = {
    employeeId,
    businessId,
    status: { [Op.notIn]: ['cancelled'] },
    startTime: { [Op.lt]: endOfDay },
    endTime: { [Op.gt]: startOfDay }
  };

  if (excludeId) {
    whereCondition.id = { [Op.ne]: excludeId };
  }

  const existingAppointments = await Appointment.findAll({
    where: whereCondition
  });

  console.log(`[Availability] Citas existentes (no canceladas): ${existingAppointments.length}`, 
    existingAppointments.map(a => ({ id: a.id, status: a.status, start: a.startTime, end: a.endTime }))
  );

  // Generar slots disponibles
  const duration = service.durationMin || service.duration || 30;
  console.log(`[Availability] Duración servicio: ${duration}min, allowPast: ${allowPast}`);
  
  const nowColombia = getNowColombia();
  const slots = generateAvailableSlots(
    workSchedules,
    lunchRanges,
    blockedRanges,
    existingAppointments,
    duration,
    dateObj,
    allowPast,
    nowColombia
  );

  console.log(`[Availability] Slots generados: ${slots.length}`, slots.length > 0 ? `Primero: ${slots[0].time}, Último: ${slots[slots.length-1].time}` : 'NINGUNO');

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

/**
 * Genera slots disponibles considerando citas existentes, almuerzo y bloqueos
 */
function generateAvailableSlots(workSchedules, lunchRanges, blockedRanges, existingAppointments, duration, dateObj, allowPast, nowColombia) {
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

  const overlaps = (start1, end1, start2, end2) => {
    return start1 < end2 && end1 > start2;
  };

  // ==================== ORDENAR HORARIOS ====================

  workSchedules.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  // ==================== GENERACIÓN ====================

  for (const sched of workSchedules) {
    const workStart = toMinutes(sched.startTime);
    const workEnd = toMinutes(sched.endTime);

    let current = workStart;

    // 🔥 CORRECTO: el slot debe TERMINAR dentro del horario
    while (current + safeDuration <= workEnd) {

      const hh = String(Math.floor(current / 60)).padStart(2, '0');
      const mm = String(current % 60).padStart(2, '0');
      const timeStr = `${hh}:${mm}`;

      const slotTime = new Date(`${dateObj.toISOString().split('T')[0]}T${timeStr}:00-05:00`);
      const slotEndTime = new Date(slotTime.getTime() + safeDuration * 60000);

      // ==================== 1. VALIDAR PASADO ====================

      if (!allowPast) {
        const MARGIN_MS = 5 * 60 * 1000;
        if (slotTime.getTime() <= (nowColombia.getTime() - MARGIN_MS)) {
          current += SLOT_INTERVAL;
          continue;
        }
      }

      // ==================== 2. CITAS EXISTENTES ====================

      const conflictAppt = existingAppointments.find(appt => {
        const apptS = dateToMinutesColombia(appt.startTime);
        const apptE = dateToMinutesColombia(appt.endTime);
        return overlaps(current, current + safeDuration, apptS, apptE);
      });

      if (conflictAppt) {
        // Saltar exactamente al final de la cita - el siguiente slot inicia cuando termina esta
        current = dateToMinutesColombia(conflictAppt.endTime);
        continue;
      }

      // ==================== 3. BLOQUEOS / ALMUERZO ====================

      const conflictBlock = [...lunchRanges, ...blockedRanges].find(r => {
        const blockStart = toMinutes(r.startTime);
        const blockEnd = toMinutes(r.endTime);
        return overlaps(current, current + safeDuration, blockStart, blockEnd);
      });

      if (conflictBlock) {
        const blockEnd = toMinutes(conflictBlock.endTime);

        if (blockEnd >= workEnd) break;

        current = blockEnd;
        continue;
      }

      // ==================== 4. SLOT VÁLIDO ====================

      slots.push({
        time: timeStr,
        startTime: slotTime.toISOString(),
        endTime: slotEndTime.toISOString()
      });

      // 🔥 CLAVE: avanzar por intervalo, NO por duración
      current += SLOT_INTERVAL;
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
    const empSpecial = specialSchedules.filter(s => s.employeeId === employeeId);
    const bizSpecial = specialSchedules.filter(s => s.employeeId === null);

    // Prioridad para horarios de trabajo: Empleado > Negocio
    const empWork = empSpecial.filter(s => s.type === 'work');
    const bizWork = bizSpecial.filter(s => s.type === 'work');
    workSchedules = empWork.length > 0 ? empWork : bizWork;

    // Combinar bloqueos y almuerzos (negocio + empleado)
    lunchRanges = specialSchedules.filter(s => s.type === 'lunch');
    blockedRanges = specialSchedules.filter(s => s.type === 'blocked');

    // Si los horarios especiales no incluyen un horario de trabajo ('work'),
    // cargamos el horario regular y le agregamos estos bloqueos/almuerzos.
    if (workSchedules.length === 0) {
      const regularSchedules = await Schedule.findAll({
        where: { employeeId, dayOfWeek, active: true }
      });
      
      workSchedules = regularSchedules.filter(s => (s.type || 'work').trim().toLowerCase() === 'work');
      
      // Combinar con almuerzos y bloqueos regulares
      lunchRanges = [
        ...lunchRanges,
        ...regularSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'lunch')
      ];
      
      blockedRanges = [
        ...blockedRanges,
        ...regularSchedules.filter(s => (s.type || '').trim().toLowerCase() === 'blocked')
      ];
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
  const duration = service.durationMin || service.duration || 30;
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

  // Verificar si está dentro de algún horario de trabajo
  const inWorkSchedule = workSchedules.some(sched => {
    const workStart = toMinutes(sched.startTime);
    const workEnd = toMinutes(sched.endTime);
    console.log('[validateManualTime] Checking schedule:', {
      workStart,
      workEnd,
      manualStart,
      manualEnd,
      condition: manualStart >= workStart && manualEnd <= workEnd
    });
    return manualStart >= workStart && manualEnd <= workEnd;
  });

  if (!inWorkSchedule) {
    return { valid: false, reason: 'La hora seleccionada está fuera del horario de trabajo del empleado' };
  }

  // Verificar conflicto con almuerzo o bloqueos
  const conflictBlock = [...lunchRanges, ...blockedRanges].find(r => {
    const blockStart = toMinutes(r.startTime);
    const blockEnd = toMinutes(r.endTime);
    return manualStart < blockEnd && manualEnd > blockStart;
  });

  if (conflictBlock) {
    return { valid: false, reason: 'La hora seleccionada coincide con un horario de almuerzo o bloqueo' };
  }

  // Verificar conflicto con citas existentes
  const startOfDay = new Date(`${date}T00:00:00-05:00`);
  const endOfDay = new Date(`${date}T23:59:59.999-05:00`);

  const existingAppointments = await Appointment.findAll({
    where: {
      employeeId,
      businessId,
      status: { [Op.notIn]: ['cancelled'] },
      startTime: { [Op.lt]: endOfDay },
      endTime: { [Op.gt]: startOfDay }
    }
  });

  const slotTime = new Date(`${date}T${manualTime}:00-05:00`);
  const slotEndTime = new Date(slotTime.getTime() + duration * 60000);

  const conflictAppt = existingAppointments.find(appt => {
    const apptStart = new Date(appt.startTime).getTime();
    const apptEnd = new Date(appt.endTime).getTime();
    const slotS = slotTime.getTime();
    const slotE = slotEndTime.getTime();
    
    // Un slot nuevo puede empezar exactamente cuando termina el anterior
    // Usamos un margen de 1000ms (1 segundo) para evitar problemas de precisión
    return slotS < (apptEnd - 1000) && slotE > (apptStart + 1000);
  });

  if (conflictAppt) {
    return { valid: false, reason: 'El empleado ya tiene una cita en ese horario' };
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
