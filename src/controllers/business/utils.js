/**
 * Utilidades para el módulo de negocios
 */
const { COLOMBIA_OFFSET_MS } = require('./constants');

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

/**
 * Verifica si el usuario es dueño o manager de un negocio
 */
async function checkBusinessAccess(business, user, Employee) {
  const isOwner = business.ownerId === user.id;
  const emp = await Employee.findOne({ 
    where: { userId: user.id, businessId: business.id, isManager: true } 
  });
  const isManager = !!emp || user.role === 'admin_suc';
  
  return { isOwner, isManager, hasAccess: isOwner || isManager };
}

/**
 * Busca el negocio principal del usuario (no sucursal)
 */
async function findParentBusiness(userId, Business) {
  return Business.findOne({ 
    where: { ownerId: userId, isBranch: false }
  });
}

/**
 * Busca el negocio donde el usuario es empleado manager
 */
async function findManagedBusiness(userId, userRole, Business, Employee) {
  if (userRole !== 'admin_suc') return null;
  
  const emp = await Employee.findOne({ where: { userId, isManager: true } });
  if (!emp) return null;
  
  const currentBiz = await Business.findByPk(emp.businessId);
  if (!currentBiz) return null;
  
  if (currentBiz.isBranch) {
    return Business.findByPk(currentBiz.parentBusinessId);
  }
  return currentBiz;
}

/**
 * Construye el objeto de include estándar para consultas de negocio
 */
function buildBusinessInclude(Service, Employee, User, Business) {
  return [
    { model: Service, as: 'Services', where: { active: true }, required: false },
    {
      model: Employee, as: 'Employees', where: { active: true }, required: false,
      include: [{ model: User, attributes: ['id', 'name', 'email'] }]
    },
    { model: Business, as: 'ParentBusiness', attributes: ['id', 'name', 'whatsapp', 'hasFieldTechnicians'] }
  ];
}

module.exports = {
  colombiaDateFromString,
  getDayOfWeekColombia,
  colombiaDateTimeToUTC,
  checkBusinessAccess,
  findParentBusiness,
  findManagedBusiness,
  buildBusinessInclude
};
