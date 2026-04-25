/**
 * Calificaciones de empleados - Versión Original
 */

const { Employee, Appointment, Service, User } = require('../../models');
const { Op } = require('sequelize');

/**
 * Obtener calificaciones del empleado logueado
 */
async function getMyRatings(req, res) {
  try {
    const userId = req.user.id;

    const employee = await Employee.findOne({
      where: { userId, active: true },
      include: [{ model: User, attributes: ['name', 'email'] }]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Buscar citas completadas con calificación
    const ratedAppointments = await Appointment.findAll({
      where: {
        employeeId: employee.id,
        status: 'done',
        rating: { [Op.not]: null }
      },
      include: [
        { model: Service, attributes: ['name'] }
      ],
      order: [['updatedAt', 'DESC']]
    });

    const ratings = ratedAppointments.map(apt => ({
      id: apt.id,
      date: apt.startTime,
      rating: apt.rating,
      comment: apt.ratingComment,
      clientName: apt.clientName,
      service: apt.Service.name,
      createdAt: apt.updatedAt
    }));

    // Calcular estadísticas
    const totalRatings = ratings.length;
    const avgRating = totalRatings > 0 
      ? (ratings.reduce((sum, r) => sum + r.rating, 0) / totalRatings).toFixed(1)
      : 0;
    
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratings.forEach(r => {
      if (distribution[r.rating] !== undefined) distribution[r.rating]++;
    });

    res.json({
      ratings,
      stats: {
        total: totalRatings,
        avgRating: parseFloat(avgRating),
        distribution
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getMyRatings
};
