/**
 * Consultas a base de datos para recordatorios
 */
const { Appointment, Service, Employee, User, Business, ClientDevice, Op } = require('../../models');
const { REMINDER_CONFIG, REFERENCE_CONFIG, MS_PER_MINUTE, COLOMBIA_TIME_OPTIONS } = require('./config');

const DEFAULT_INCLUDES = [
  { model: Service },
  { model: Employee, include: [{ model: User, attributes: ['name', 'pushToken'] }] },
  { model: Business },
  { model: User, as: 'Client', attributes: ['email', 'pushToken'] },
];

function buildTimeWindow(now, reminderMs, windowMinutes) {
  const margin = windowMinutes * MS_PER_MINUTE;
  return {
    start: new Date(now + reminderMs - margin),
    end: new Date(now + reminderMs + margin),
  };
}

function buildFutureWindow(now, reminderMs, windowMinutes) {
  return {
    end: new Date(now + reminderMs + (windowMinutes * MS_PER_MINUTE)),
    start: new Date(now),
  };
}

async function findAppointmentsForReminder({ now, reminderMs, field, windowMinutes, requireFieldTechnicians = false }) {
  const window = buildTimeWindow(now, reminderMs, windowMinutes);

  const whereClause = {
    startTime: { [Op.lte]: window.end, [Op.gte]: window.start },
    status: { [Op.in]: ['pending', 'confirmed'] },
    [field]: false,
  };

  const include = [...DEFAULT_INCLUDES];
  if (requireFieldTechnicians) {
    include[2] = { model: Business, where: { hasFieldTechnicians: true } };
  }

  return Appointment.findAll({ where: whereClause, include });
}

async function findAppointmentsForFutureReminder({ now, reminderMs, field, windowMinutes }) {
  const window = buildFutureWindow(now, reminderMs, windowMinutes);

  return Appointment.findAll({
    where: {
      startTime: { [Op.lte]: window.end, [Op.gt]: window.start },
      status: { [Op.in]: ['pending', 'confirmed'] },
      [field]: false,
    },
    include: DEFAULT_INCLUDES,
  });
}

async function findAppointmentsForReference(now) {
  const margin = REFERENCE_CONFIG.windowMinutes * MS_PER_MINUTE;

  return Appointment.findAll({
    where: {
      startTime: { [Op.lte]: new Date(now + margin), [Op.gte]: new Date(now - margin) },
      status: 'confirmed',
      [REFERENCE_CONFIG.field]: false,
    },
    include: DEFAULT_INCLUDES,
  });
}

async function findClientPushToken(appt) {
  let token = appt.Client?.pushToken;
  if (!token && appt.clientEmail) {
    const device = await ClientDevice.findOne({
      where: { email: appt.clientEmail.toLowerCase().trim() },
    });
    token = device?.pushToken;
  }
  return token;
}

async function findClientEmail(appt) {
  if (appt.clientEmail) return appt.clientEmail;
  if (appt.clientId) {
    const user = await User.findByPk(appt.clientId);
    return user?.email;
  }
  return null;
}

module.exports = {
  REMINDER_CONFIG,
  REFERENCE_CONFIG,
  findAppointmentsForReminder,
  findAppointmentsForFutureReminder,
  findAppointmentsForReference,
  findClientPushToken,
  findClientEmail,
};
