/**
 * Utilidades compartidas para empleados - Versión Original
 */

const { Op } = require('sequelize');
const { Employee, Business, User } = require('../../models');

// Helper para verificar límite de empleados (el dueño/admin NO cuenta)
async function checkUserLimit(businessId) {
  const business = await Business.findByPk(businessId);
  if (!business) return { allowed: false, error: 'Negocio no encontrado' };

  const maxUsers = business.includedUsers + business.additionalUsers;

  // Usar subconsulta en lugar de include para evitar el JOIN incorrecto
  const currentEmployees = await Employee.count({
    where: {
      businessId,
      active: true
    },
    distinct: true,
    col: 'Employee.id'
  });

  // Filtrar admins manualmente
  const allEmployees = await Employee.findAll({
    where: { businessId, active: true },
    attributes: ['id'],
    include: [{
      model: User,
      attributes: ['role']
    }]
  });

  let nonAdminEmployees = 0;
  let branchManagerExonerated = false;
  const isBranch = business.isBranch === true;

  allEmployees.forEach(emp => {
    const isGlobalOwner = emp.User?.role === 'admin';
    const isManagerRole = emp.User?.role === 'admin_suc' || emp.isManager === true;
    
    let shouldBeExempt = false;

    if (isGlobalOwner) {
      shouldBeExempt = true;
    } else if (isBranch && isManagerRole && !branchManagerExonerated) {
      shouldBeExempt = true;
      branchManagerExonerated = true;
    }

    if (!shouldBeExempt) {
      nonAdminEmployees++;
    }
  });

  if (nonAdminEmployees >= maxUsers) {
    return {
      allowed: false,
      error: `Has alcanzado el límite de ${maxUsers} empleados. Contrata más empleados para continuar.`,
      current: nonAdminEmployees,
      max: maxUsers
    };
  }

  return { allowed: true, current: nonAdminEmployees, max: maxUsers };
}

// Helpers para fechas en zona horaria Colombia
const getColombiaDate = (date = new Date()) => {
  return new Date(date.toLocaleString("en-US", {timeZone: "America/Bogota"}));
};

const startOfDay = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00-05:00');
  return d;
};

const endOfDay = (dateStr) => {
  // Crear fecha base en Colombia
  const base = new Date(dateStr + 'T00:00:00-05:00');
  // Sumar un día
  base.setDate(base.getDate() + 1);
  // Retornar el inicio del día siguiente (exclusivo)
  const nextDayStr = base.toISOString().slice(0, 10);
  return new Date(nextDayStr + 'T00:00:00-05:00');
};

const startOfWeek = (dateStr) => {
  // Crear fecha base en Colombia
  const base = new Date(dateStr + 'T00:00:00-05:00');
  const day = base.getDay(); // 0 = domingo, 1 = lunes, etc.
  const diff = day === 0 ? -6 : 1 - day; // Días para retroceder al lunes
  
  // Calcular nueva fecha en Colombia
  const result = new Date(base.getTime() + diff * 24 * 60 * 60 * 1000);
  return new Date(result.toISOString().slice(0, 10) + 'T00:00:00-05:00');
};

const endOfWeek = (dateStr) => {
  const start = startOfWeek(dateStr);
  // Sumar 7 días para llegar al lunes siguiente (inicio exclusivo)
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const nextMondayStr = end.toISOString().slice(0, 10);
  return new Date(nextMondayStr + 'T00:00:00-05:00');
};

const startOfMonth = (monthStr) => {
  // Crear fecha en zona horaria Colombia (UTC-5)
  return new Date(monthStr + '-01T00:00:00-05:00');
};

const endOfMonth = (monthStr) => {
  // Crear fecha del primer día del mes en Colombia
  const firstDay = new Date(monthStr + '-01T00:00:00-05:00');
  // Ir al primer día del mes siguiente (exclusivo)
  const year = firstDay.getFullYear();
  const month = firstDay.getMonth(); // 0-11
  const nextMonthFirstDay = new Date(year, month + 1, 1);
  const nextMonthStr = nextMonthFirstDay.toISOString().slice(0, 10);
  return new Date(nextMonthStr + 'T00:00:00-05:00');
};

module.exports = {
  checkUserLimit,
  getColombiaDate,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth
};
