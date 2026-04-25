/**
 * Agenda y calendario de empleados - Versión Original
 */

const { Appointment, Service, Business } = require('../../models');
const { Op } = require('sequelize');

/**
 * Obtener citas del día (hoy)
 */
async function getTodayAppointments(req, res) {
  try {
    const employeeId = req.params.employeeId;
    // Forzar fecha actual en Colombia (UTC-5)
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const today = new Date(`${todayStr}T00:00:00-05:00`);
    // Crear mañana sumando un día a la fecha de hoy
    const tomorrowDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const tomorrow = new Date(`${tomorrowStr}T00:00:00-05:00`);

    const appointments = await Appointment.findAll({
      where: {
        employeeId,
        startTime: { [Op.between]: [today, tomorrow] },
        status: { [Op.in]: ['pending', 'confirmed', 'attention', 'done', 'cancelled'] }
      },
      include: [
        { model: Service, attributes: ['name', 'price', 'durationMin'] },
        { model: Business, attributes: ['name', 'slug'] }
      ],
      order: [['startTime', 'ASC']]
    });

    // Ordenar: primero 'attention' (en atención), luego pendientes/confirmadas por hora, al final terminadas/canceladas
    const getStatusPriority = (status) => {
      if (status === 'attention') return 1; // Siempre primero
      if (['pending', 'confirmed'].includes(status)) return 2; // Por hora
      if (['done', 'cancelled'].includes(status)) return 3; // Al final
      return 4;
    };

    appointments.sort((a, b) => {
      const priorityA = getStatusPriority(a.status);
      const priorityB = getStatusPriority(b.status);

      // Si tienen diferente prioridad, ordenar por prioridad
      if (priorityA !== priorityB) return priorityA - priorityB;

      // Si tienen misma prioridad, ordenar por hora
      return new Date(a.startTime) - new Date(b.startTime);
    });

    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Obtener citas por rango de fechas
 */
async function getAppointmentsByDateRange(req, res) {
  try {
    const employeeId = req.params.employeeId;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate y endDate son requeridos' });
    }

    const appointments = await Appointment.findAll({
      where: {
        employeeId,
        startTime: { [Op.between]: [new Date(`${startDate}T00:00:00-05:00`), new Date(`${endDate}T23:59:59-05:00`)] },
        status: { [Op.in]: ['pending', 'confirmed', 'attention', 'done', 'cancelled'] }
      },
      include: [
        { model: Service, attributes: ['name', 'price', 'durationMin'] },
        { model: Business, attributes: ['name', 'slug'] }
      ],
      order: [['startTime', 'ASC']]
    });

    // Ordenar: primero 'attention' (en atención), luego pendientes/confirmadas por hora, al final terminadas/canceladas
    // Prioridad: attention (1) > pending/confirmed por hora (2) > done/cancelled (3)
    appointments.sort((a, b) => {
      const getStatusPriority = (status) => {
        if (status === 'attention') return 1; // Siempre primero
        if (['pending', 'confirmed'].includes(status)) return 2; // Por hora
        if (['done', 'cancelled'].includes(status)) return 3; // Al final
        return 4;
      };

      const priorityA = getStatusPriority(a.status);
      const priorityB = getStatusPriority(b.status);

      // Si tienen diferente prioridad, ordenar por prioridad
      if (priorityA !== priorityB) return priorityA - priorityB;

      // Si tienen misma prioridad, ordenar por hora
      return new Date(a.startTime) - new Date(b.startTime);
    });

    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getTodayAppointments,
  getAppointmentsByDateRange
};
