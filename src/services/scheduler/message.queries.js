/**
 * Consultas a base de datos para mensajes programados
 */
const { ScheduledMessage, IncomingMessage, Appointment, Op } = require('../../models');
const { CONFIG } = require('./config');

/**
 * Obtiene mensajes pendientes agrupados por negocio
 */
async function getPendingMessagesGrouped() {
  const now = new Date();

  console.log(`[Scheduler] 🔍 Buscando mensajes pendientes...`);
  console.log(`[Scheduler]    - Ahora (UTC): ${now.toISOString()}`);
  console.log(`[Scheduler]    - Ahora (COL): ${new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString().replace('Z', '-05:00')}`);

  // Debug: contar todos los mensajes pendientes (incluyendo futuros)
  const allPending = await ScheduledMessage.count({ where: { status: 'pending' } });
  const futurePending = await ScheduledMessage.count({
    where: { status: 'pending', scheduledAt: { [Op.gt]: now } }
  });
  const failedCount = await ScheduledMessage.count({ where: { status: 'failed' } });

  if (allPending > 0) {
    console.log(`[Scheduler] 📊 Total mensajes pending: ${allPending} (listos para enviar: ${allPending - futurePending}, futuros: ${futurePending}, failed: ${failedCount})`);
  }

  const messages = await ScheduledMessage.findAll({
    where: {
      status: 'pending',
      scheduledAt: { [Op.lte]: now },
      retryCount: { [Op.lt]: CONFIG.MAX_RETRIES },
    },
    order: [['scheduledAt', 'ASC'], ['businessId', 'ASC']],
    limit: CONFIG.BATCH_LIMIT,
  });

  // Agrupar por negocio
  const grouped = {};
  for (const msg of messages) {
    if (!grouped[msg.businessId]) {
      grouped[msg.businessId] = [];
    }
    grouped[msg.businessId].push(msg);
  }

  return grouped;
}

/**
 * Busca mensajes entrantes pendientes de los últimos N días
 */
async function getPendingIncomingMessages(businessId, maxAgeDays = CONFIG.INCOMING_MAX_AGE_DAYS) {
  const oneWeekAgo = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  return IncomingMessage.findAll({
    where: {
      businessId,
      status: 'pending',
      createdAt: { [Op.gte]: oneWeekAgo },
    },
    order: [['createdAt', 'ASC']],
    limit: CONFIG.INCOMING_BATCH_LIMIT,
  });
}

/**
 * Busca citas activas para un número de teléfono
 */
async function findAppointmentsForPhone(businessId, phone) {
  return Appointment.findAll({
    where: {
      businessId,
      clientPhone: { [Op.like]: `%${phone}%` },
      status: { [Op.in]: ['pending', 'confirmed', 'attention', 'done'] },
    },
    order: [['startTime', 'DESC']],
  });
}

/**
 * Cancela mensajes pendientes de una cita
 */
async function cancelAppointmentMessages(appointmentId) {
  const { ScheduledMessage } = require('../../models');

  const result = await ScheduledMessage.update(
    { status: 'cancelled' },
    {
      where: {
        appointmentId,
        status: { [Op.in]: ['pending', 'failed'] },
      },
    }
  );

  console.log(`[Scheduler] 🚫 ${result[0]} mensajes cancelados para cita ${appointmentId}`);
  return result[0];
}

module.exports = {
  getPendingMessagesGrouped,
  getPendingIncomingMessages,
  findAppointmentsForPhone,
  cancelAppointmentMessages,
};
