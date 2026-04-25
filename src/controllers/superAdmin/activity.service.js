const { sequelize, ActivityLog, User, Op } = require('../../models');

async function getActivityLogs(req, res) {
  try {
    const { 
      userId, 
      action, 
      entityType, 
      startDate, 
      endDate, 
      page = 1, 
      limit = 50 
    } = req.query;
    
    const where = {};
    
    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    const offset = (page - 1) * limit;
    
    const { count, rows: logs } = await ActivityLog.findAndCountAll({
      where,
      include: [
        { 
          model: User, 
          as: 'User', 
          attributes: ['id', 'name', 'email', 'role'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      logs,
      pagination: {
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit),
        limit: parseInt(limit)
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function getActivityStats(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const where = {};
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[Op.gte] = new Date(startDate);
      if (endDate) where.createdAt[Op.lte] = new Date(endDate);
    }

    // Total de acciones por tipo
    const actionsByType = await ActivityLog.findAll({
      where,
      attributes: ['action', [sequelize.fn('COUNT', sequelize.col('action')), 'count']],
      group: ['action'],
      raw: true
    });

    // Total por día (últimos 30 días)
    const logsByDay = await ActivityLog.findAll({
      where: {
        ...where,
        createdAt: { [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      },
      attributes: [
        [sequelize.fn('DATE', sequelize.col('createdAt')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('ActivityLog.id')), 'count']
      ],
      group: [sequelize.fn('DATE', sequelize.col('createdAt'))],
      order: [[sequelize.fn('DATE', sequelize.col('createdAt')), 'ASC']],
      raw: true
    });

    // Usuarios más activos
    const topUsers = await ActivityLog.findAll({
      where,
      attributes: ['userId', 'userEmail', [sequelize.fn('COUNT', sequelize.col('ActivityLog.id')), 'count']],
      group: ['userId', 'userEmail'],
      order: [[sequelize.fn('COUNT', sequelize.col('ActivityLog.id')), 'DESC']],
      limit: 10,
      raw: true
    });

    res.json({
      actionsByType,
      logsByDay,
      topUsers,
      total: await ActivityLog.count({ where })
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getActivityLogs,
  getActivityStats,
};
