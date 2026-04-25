const { sequelize, Appointment, Business, User, Op } = require('../../models');

async function getGlobalFinancialReport(req, res) {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate) dateFilter[Op.gte] = new Date(startDate);
    if (endDate) dateFilter[Op.lte] = new Date(endDate);

    // Total de citas y revenue
    const appointments = await Appointment.findAll({
      where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {},
      include: [{ model: Business, attributes: ['id', 'name'] }]
    });

    const totalRevenue = appointments.reduce((sum, a) => sum + (parseFloat(a.finalPrice) || 0), 0);

    // Citas por estado
    const byStatus = await Appointment.findAll({
      where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {},
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('Appointment.id')), 'count']],
      group: ['status'],
      raw: true
    });

    // Revenue por negocio
    const byBusiness = await Appointment.findAll({
      where: Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {},
      attributes: [
        'businessId',
        [sequelize.fn('SUM', sequelize.col('finalPrice')), 'total'],
        [sequelize.fn('COUNT', sequelize.col('Appointment.id')), 'appointments']
      ],
      include: [{ model: Business, attributes: ['name'] }],
      group: ['businessId', 'Business.id', 'Business.name'],
      raw: true
    });

    res.json({
      summary: {
        totalAppointments: appointments.length,
        totalRevenue,
        averagePerAppointment: appointments.length > 0 ? totalRevenue / appointments.length : 0
      },
      byStatus,
      byBusiness
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function getGlobalStats(req, res) {
  try {
    const stats = {
      users: {
        total: await User.count(),
        byRole: await User.findAll({
          attributes: ['role', [sequelize.fn('COUNT', sequelize.col('User.id')), 'count']],
          group: ['role'],
          raw: true
        }),
        active: await User.count({ where: { status: 'active' } }),
        blocked: await User.count({ where: { status: 'blocked' } }),
        newThisMonth: await User.count({
          where: {
            createdAt: { [Op.gte]: new Date(new Date().setDate(1)) }
          }
        })
      },
      businesses: {
        total: await Business.count(),
        active: await Business.count({ where: { status: 'active' } }),
        blocked: await Business.count({ where: { status: 'blocked' } }),
        branches: await Business.count({ where: { isBranch: true } }),
        bySubscription: await Business.findAll({
          attributes: ['subscriptionStatus', [sequelize.fn('COUNT', sequelize.col('Business.id')), 'count']],
          group: ['subscriptionStatus'],
          raw: true
        })
      },
      appointments: {
        total: await Appointment.count(),
        today: await Appointment.count({
          where: {
            startTime: { 
              [Op.gte]: new Date(new Date().setHours(0,0,0,0)),
              [Op.lt]: new Date(new Date().setHours(24,0,0,0))
            }
          }
        }),
        thisMonth: await Appointment.count({
          where: {
            startTime: { [Op.gte]: new Date(new Date().setDate(1)) }
          }
        })
      }
    };

    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getGlobalFinancialReport,
  getGlobalStats,
};
