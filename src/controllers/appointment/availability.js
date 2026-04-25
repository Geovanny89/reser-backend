/**
 * Lógica de disponibilidad de horarios
 */

const { Appointment, Service, Employee, Business, Schedule, SpecialSchedule, EmployeeVacation, Promotion, Op, sequelize } = require('../../models');
const { colombiaDateFromString, getDayOfWeekColombia, COLOMBIA_OFFSET_MS } = require('./utils');

/**
 * Obtiene disponibilidad de horarios para una fecha, empleado y servicio
 */
async function getAvailability(date, employeeId, serviceId, businessId, allowPast = false) {
  // Validar parámetros
  if (!date || !employeeId || !serviceId || !businessId) {
    throw new Error('Fecha, empleado, servicio y negocio son requeridos');
  }

  const service = await Service.findByPk(serviceId);
  if (!service) throw new Error('Servicio no encontrado');

  const business = await Business.findByPk(businessId);
  if (!business) throw new Error('Negocio no encontrado');

  // Verificar si el empleado está de vacaciones en esta fecha
  const vacationCount = await EmployeeVacation.count({
    where: {
      employeeId,
      active: true,
      startDate: { [Op.lte]: date },
      endDate: { [Op.gte]: date }
    }
  });

  if (vacationCount > 0) {
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
      return { availableSlots: [] };
    }

    const employeeSpecific = specialSchedules.filter(s => s.employeeId === employeeId);
    const generalOnes = specialSchedules.filter(s => s.employeeId === null);
    const schedulesToUse = employeeSpecific.length > 0 ? employeeSpecific : generalOnes;

    workSchedules = schedulesToUse.filter(s => s.type === 'work');
    lunchRanges = schedulesToUse.filter(s => s.type === 'lunch');
    blockedRanges = schedulesToUse.filter(s => s.type === 'blocked');
    empSchedules = schedulesToUse;
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
  }

  if (workSchedules.length === 0) {
    return { availableSlots: [] };
  }

  // Obtener citas existentes (usando fechas con offset Colombia explícito)
  const startOfDay = new Date(`${date}T00:00:00-05:00`);
  const endOfDay = new Date(`${date}T23:59:59.999-05:00`);

  const existingAppointments = await Appointment.findAll({
    where: {
      employeeId,
      businessId,
      status: { [Op.or]: [{ [Op.notIn]: ['cancelled'] }, { [Op.is]: null }] },
      startTime: { [Op.lt]: endOfDay },
      endTime: { [Op.gt]: startOfDay }
    }
  });

  // Generar slots disponibles
  const duration = service.durationMin || service.duration || 30;
  const slots = generateAvailableSlots(
    workSchedules,
    lunchRanges,
    blockedRanges,
    existingAppointments,
    duration,
    dateObj,
    allowPast
  );

  // Verificar promociones
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
function generateAvailableSlots(workSchedules, lunchRanges, blockedRanges, existingAppointments, duration, dateObj, allowPast) {
  if (!workSchedules || workSchedules.length === 0) return [];

  const slots = [];
  const safeDuration = (duration && duration > 0) ? Number(duration) : 30;

  const SLOT_INTERVAL = 15; // 🔥 clave: granularidad (puedes usar 10, 15, 20, etc.)

  // ==================== HELPERS ====================

  const toMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = String(timeStr).trim().split(':').map(Number);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  };

  const dateToMinutesColombia = (date) => {
    const d = new Date(date);
    const localMs = d.getTime() + COLOMBIA_OFFSET_MS;
    const localDate = new Date(localMs);
    return localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
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
        if (slotTime.getTime() <= (Date.now() - MARGIN_MS)) {
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
        // Saltar hasta que termine la cita
        current = dateToMinutesColombia(conflictAppt.endTime);
        // NO hacer continue - permitir verificar si el slot cabe a esta hora exacta
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

  // Verificar si el empleado está de vacaciones
  const vacationCount = await EmployeeVacation.count({
    where: {
      employeeId,
      active: true,
      startDate: { [Op.lte]: date },
      endDate: { [Op.gte]: date }
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
      return { valid: false, reason: 'El negocio está cerrado en esta fecha' };
    }

    const employeeSpecific = specialSchedules.filter(s => s.employeeId === employeeId);
    const generalOnes = specialSchedules.filter(s => s.employeeId === null);
    const schedulesToUse = employeeSpecific.length > 0 ? employeeSpecific : generalOnes;

    workSchedules = schedulesToUse.filter(s => s.type === 'work');
    lunchRanges = schedulesToUse.filter(s => s.type === 'lunch');
    blockedRanges = schedulesToUse.filter(s => s.type === 'blocked');
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
  }

  if (workSchedules.length === 0) {
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
      status: { [Op.or]: [{ [Op.notIn]: ['cancelled'] }, { [Op.is]: null }] },
      startTime: { [Op.lt]: endOfDay },
      endTime: { [Op.gt]: startOfDay }
    }
  });

  const slotTime = new Date(`${date}T${manualTime}:00-05:00`);
  const slotEndTime = new Date(slotTime.getTime() + duration * 60000);

  const conflictAppt = existingAppointments.find(appt => {
    const apptStart = new Date(appt.startTime);
    const apptEnd = new Date(appt.endTime);
    return slotTime < apptEnd && slotEndTime > apptStart;
  });

  if (conflictAppt) {
    return { valid: false, reason: 'El empleado ya tiene una cita en ese horario' };
  }

  // Verificar si ya pasó (con margen de 5 minutos)
  const MARGIN_MS = 5 * 60 * 1000;
  if (slotTime.getTime() <= (Date.now() - MARGIN_MS)) {
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
