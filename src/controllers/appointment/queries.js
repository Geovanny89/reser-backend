/**
 * Consultas y queries de citas
 */

const { Appointment, Service, Employee, User, Business, AppointmentEmployee, Op } = require('../../models');
const { colombiaDateFromString } = require('./utils');

/**
 * Obtiene citas por negocio con filtros de fecha
 */
async function getAppointmentsByBusiness(businessId, filters = {}) {
  const { date, startDate, endDate, employeeId, limit = 100, offset = 0 } = filters;
  const where = { businessId };

  if (employeeId) {
    // Filtrar por empleado principal O empleado adicional
    where[Op.or] = [
      { employeeId: employeeId },
      { '$AdditionalEmployees.employeeId$': employeeId }
    ];
  }

  if (date) {
    const d = colombiaDateFromString(date);
    // Calcular el día siguiente sumando 24 horas en milisegundos
    const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    where.startTime = { [Op.between]: [d, next] };
  } else if (startDate && endDate) {
    const start = colombiaDateFromString(startDate);
    const end = new Date(`${endDate}T23:59:59-05:00`);
    where.startTime = { [Op.between]: [start, end] };
  }

  const appointments = await Appointment.findAll({
    where,
    include: [
      { model: Service, attributes: ['id', 'name', 'durationMin', 'price', 'color'] },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ],
    order: [['startTime', 'ASC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  return appointments.map(a => a.toJSON());
}

/**
 * Obtiene citas consolidadas para un usuario (negocio principal + sucursales)
 */
async function getConsolidatedAppointments(userId, options = {}) {
  const { daysBack = 30, limit = 200, status } = options;

  // Buscar el negocio principal
  let mainBiz = await Business.findOne({ where: { ownerId: userId, isBranch: false } });

  if (!mainBiz) {
    const emp = await Employee.findOne({ where: { userId, isManager: true } });
    if (emp) {
      mainBiz = await Business.findByPk(emp.businessId);
    }
  }

  if (!mainBiz) return null;

  // Obtener IDs de negocios (principal + sucursales)
  let businessIds = [mainBiz.id];
  if (!mainBiz.isBranch) {
    const branches = await Business.findAll({
      where: { parentBusinessId: mainBiz.id },
      attributes: ['id']
    });
    businessIds = [...businessIds, ...branches.map(b => b.id)];
  }

  // Calcular fecha límite (días hacia atrás)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const where = {
    businessId: { [Op.in]: businessIds },
    startTime: { [Op.gte]: cutoffDate }
  };

  if (status) where.status = status;

  const appointments = await Appointment.findAll({
    where,
    include: [
      { model: Service, attributes: ['id', 'name', 'durationMin', 'price', 'color'] },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ],
    order: [['startTime', 'DESC']],
    limit: parseInt(limit)
  });

  return appointments.map(a => a.toJSON());
}

/**
 * Obtiene citas de un empleado
 */
async function getEmployeeAppointments(employeeId, options = {}) {
  const { daysBack = 30, daysForward = 30 } = options;

  const startCutoff = new Date();
  startCutoff.setDate(startCutoff.getDate() - daysBack);

  const endCutoff = new Date();
  endCutoff.setDate(endCutoff.getDate() + daysForward);

  return await Appointment.findAll({
    where: {
      [Op.or]: [
        { employeeId },
        { '$AdditionalEmployees.employeeId$': employeeId }
      ],
      status: { [Op.in]: ['pending', 'confirmed', 'attention'] },
      startTime: { [Op.between]: [startCutoff, endCutoff] }
    },
    include: [
      { model: Service, attributes: ['id', 'name', 'durationMin', 'price', 'color'] },
      { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
    ],
    order: [['startTime', 'ASC']],
    limit: 100
  });
}

/**
 * Obtiene citas de un cliente
 */
async function getClientAppointments(clientId, clientEmail) {
  const where = {};
  if (clientId) where.clientId = clientId;
  else if (clientEmail) where.clientEmail = clientEmail.toLowerCase().trim();
  else return null;

  return await Appointment.findAll({
    where,
    include: [
      { model: Service },
      { model: Business, attributes: ['id', 'name', 'slug'] },
      { model: Employee, include: [{ model: User, attributes: ['name'] }] }
    ],
    order: [['startTime', 'DESC']]
  });
}

/**
 * Obtiene una cita por ID con todas sus relaciones
 */
async function getAppointmentById(id, includeAll = true) {
  const include = includeAll ? [
    { model: Service },
    { model: Employee, include: [{ model: User, attributes: ['name'] }] },
    { model: Business, attributes: ['id', 'name', 'whatsapp', 'address', 'slug', 'logoUrl', 'isTechnicalServices', 'nit', 'phone'] },
    { model: AppointmentEmployee, as: 'AdditionalEmployees', include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }] }
  ] : [];

  return await Appointment.findByPk(id, { include });
}

module.exports = {
  getAppointmentsByBusiness,
  getConsolidatedAppointments,
  getEmployeeAppointments,
  getClientAppointments,
  getAppointmentById
};
