/**
 * Validación de conflictos por tramos reales (servicio base + extras secuenciales).
 * No usa el startTime–endTime completo de la cita cuando el profesional solo
 * atiende un segmento.
 */

const { Appointment, AppointmentEmployee, Service, Op } = require('../../models');

const MARGIN_MS = 10000;

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

/**
 * Reconstruye los rangos ocupados de un empleado dentro de una cita existente.
 * @returns {{ start: Date, end: Date }[]}
 */
function getEmployeeBusyRangesFromAppointment(appt, employeeId, baseDurationMin) {
  const principalEmpId = String(appt.employeeId);
  const target = String(employeeId);
  const extras = Array.isArray(appt.extraServices) ? appt.extraServices : [];
  const isPrincipal = principalEmpId === target;

  if (baseDurationMin == null || baseDurationMin < 0 || isNaN(baseDurationMin)) {
    if (isPrincipal) {
      return [{ start: new Date(appt.startTime), end: new Date(appt.endTime) }];
    }
    return [];
  }

  const ranges = [];
  let cursor = new Date(appt.startTime).getTime();

  const baseEnd = cursor + baseDurationMin * 60000;
  if (isPrincipal) {
    ranges.push({ start: new Date(cursor), end: new Date(baseEnd) });
  }
  cursor = baseEnd;

  for (const es of extras) {
    const d = parseInt(es.durationMin) || 0;
    const blockStart = cursor;
    const blockEnd = cursor + d * 60000;
    const empForExtra = es.employeeId && String(es.employeeId) !== principalEmpId
      ? String(es.employeeId)
      : principalEmpId;
    if (empForExtra === target) {
      ranges.push({ start: new Date(blockStart), end: new Date(blockEnd) });
    }
    cursor = blockEnd;
  }

  return ranges;
}

function rangesOverlap(s1, e1, s2, e2, marginMs = MARGIN_MS) {
  return s1.getTime() < (e2.getTime() - marginMs) && e1.getTime() > (s2.getTime() + marginMs);
}

function formatRange(start, end) {
  const opts = { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' };
  const t1 = new Date(start).toLocaleTimeString('es-CO', opts);
  const t2 = new Date(end).toLocaleTimeString('es-CO', opts);
  return `${t1}-${t2}`;
}

/**
 * Lanza Error si el empleado tiene un tramo ocupado que solapa [start, end].
 */
async function assertNoEmployeeConflict({
  employeeId,
  businessId,
  start,
  end,
  labelRange,
  excludeAppointmentId = null
}) {
  const where = {
    businessId,
    status: { [Op.notIn]: ['cancelled'] },
    startTime: { [Op.lt]: new Date(end.getTime() - MARGIN_MS) },
    endTime: { [Op.gt]: new Date(start.getTime() + MARGIN_MS) },
  };
  if (excludeAppointmentId) {
    where.id = { [Op.ne]: excludeAppointmentId };
  }

  const candidates = await Appointment.findAll({
    where,
    include: [
      { model: AppointmentEmployee, as: 'AdditionalEmployees', required: false },
      { model: Service, attributes: ['id', 'durationMin'], required: false }
    ]
  });

  const involved = candidates.filter(a => appointmentInvolvesEmployee(a, employeeId));

  for (const appt of involved) {
    const rawDur = appt.Service?.durationMin;
    const baseDur = rawDur != null && !isNaN(parseInt(rawDur)) ? parseInt(rawDur) : null;
    const busy = getEmployeeBusyRangesFromAppointment(appt, employeeId, baseDur);

    for (const r of busy) {
      if (!rangesOverlap(start, end, r.start, r.end)) continue;

      const rangeLabel = formatRange(r.start, r.end);
      const asAdditional = String(appt.employeeId) !== String(employeeId);
      if (asAdditional) {
        throw new Error(
          `Conflicto: El profesional está asignado como adicional en otra cita (${rangeLabel}) y choca con "${labelRange}"`
        );
      }
      throw new Error(
        `Conflicto: El profesional tiene una cita (${rangeLabel}) que choca con "${labelRange}"`
      );
    }
  }
}

/**
 * Valida todos los bloques secuenciales de una cita nueva/editada.
 * @param {Array<{employeeId, startTime, endTime, durationMin, label}>} blocks
 */
async function assertNoBlockConflicts(blocks, { businessId, excludeAppointmentId = null } = {}) {
  for (const b of blocks) {
    if (!b.employeeId || b.durationMin <= 0) continue;
    await assertNoEmployeeConflict({
      employeeId: b.employeeId,
      businessId,
      start: b.startTime,
      end: b.endTime,
      labelRange: b.label,
      excludeAppointmentId
    });
  }
}

module.exports = {
  appointmentInvolvesEmployee,
  getEmployeeBusyRangesFromAppointment,
  rangesOverlap,
  assertNoEmployeeConflict,
  assertNoBlockConflicts,
  MARGIN_MS
};
