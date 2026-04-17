const { SpecialSchedule, Employee, User, sequelize } = require('../models');
const { Op } = require('sequelize');

exports.getByEmployee = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const where = { employeeId: req.params.employeeId, active: true };
    
    if (startDate && endDate) {
      where.specificDate = { [Op.between]: [startDate, endDate] };
    }
    
    const schedules = await SpecialSchedule.findAll({
      where,
      order: [['specificDate', 'ASC']]
    });
    res.json(schedules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getByBusiness = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const where = { businessId: req.params.businessId, active: true };
    
    if (startDate && endDate) {
      where.specificDate = { [Op.between]: [startDate, endDate] };
    }
    
    const schedules = await SpecialSchedule.findAll({
      where,
      include: [{ 
        model: Employee, 
        required: false,
        include: [{ model: User, attributes: ['name'] }] 
      }],
      order: [['specificDate', 'ASC'], ['startTime', 'ASC']]
    });
    res.json(schedules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getByDate = async (req, res) => {
  try {
    const { businessId, date } = req.query;
    if (!businessId || !date) {
      return res.status(400).json({ error: 'businessId y date son requeridos' });
    }

    // Buscar horarios especiales para esa fecha
    // También buscar horarios recurrentes anuales (mismo mes/día, cualquier año)
    const [month, day] = date.split('-').slice(1);
    
    const schedules = await SpecialSchedule.findAll({
      where: {
        businessId,
        active: true,
        [Op.or]: [
          { specificDate: date },
          { 
            isRecurringYearly: true,
            [Op.and]: [
              sequelize.where(
                sequelize.fn('EXTRACT', sequelize.literal('MONTH FROM "specificDate"')),
                parseInt(month)
              ),
              sequelize.where(
                sequelize.fn('EXTRACT', sequelize.literal('DAY FROM "specificDate"')),
                parseInt(day)
              )
            ]
          }
        ]
      },
      include: [{ 
        model: Employee, 
        required: false,
        include: [{ model: User, attributes: ['name'] }] 
      }],
      order: [['startTime', 'ASC']]
    });

    res.json(schedules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { employeeId, businessId, specificDate, startTime, endTime, type, description, isRecurringYearly } = req.body;
    
    const schedule = await SpecialSchedule.create({ 
      employeeId: employeeId || null, // null = aplica a todos los empleados
      businessId, 
      specificDate, 
      startTime, 
      endTime,
      type: type || 'work',
      description: description || null,
      isRecurringYearly: isRecurringYearly || false
    });
    
    res.status(201).json(schedule);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const schedule = await SpecialSchedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Horario especial no encontrado' });
    
    const { employeeId, businessId, specificDate, startTime, endTime, type, description, isRecurringYearly, active } = req.body;
    await schedule.update({ 
      employeeId: employeeId !== undefined ? (employeeId || null) : schedule.employeeId, 
      businessId: businessId || schedule.businessId, 
      specificDate: specificDate || schedule.specificDate, 
      startTime: startTime || schedule.startTime, 
      endTime: endTime || schedule.endTime,
      type: type || schedule.type,
      description: description !== undefined ? description : schedule.description,
      isRecurringYearly: isRecurringYearly !== undefined ? isRecurringYearly : schedule.isRecurringYearly,
      active: active !== undefined ? active : schedule.active
    });
    
    res.json(schedule);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const schedule = await SpecialSchedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Horario especial no encontrado' });
    await schedule.update({ active: false });
    res.json({ message: 'Horario especial eliminado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Verificar si una fecha tiene horario especial (para usar en disponibilidad)
exports.hasSpecialSchedule = async (businessId, date, employeeId = null) => {
  try {
    const [month, day] = date.split('-').slice(1);
    
    const where = {
      businessId,
      active: true,
      [Op.or]: [
        { specificDate: date },
        { 
          isRecurringYearly: true,
          [Op.and]: [
            sequelize.where(
              sequelize.fn('EXTRACT', sequelize.literal('MONTH FROM "specificDate"')),
              parseInt(month)
            ),
            sequelize.where(
              sequelize.fn('EXTRACT', sequelize.literal('DAY FROM "specificDate"')),
              parseInt(day)
            )
          ]
        }
      ]
    };
    
    if (employeeId) {
      where.employeeId = { [Op.or]: [employeeId, null] };
    }
    
    const count = await SpecialSchedule.count({ where });
    return count > 0;
  } catch (e) {
    console.error('Error verificando horario especial:', e);
    return false;
  }
};

// Obtener horarios especiales para una fecha (para usar en disponibilidad)
exports.getSpecialSchedulesForDate = async (businessId, date, employeeId = null) => {
  try {
    const [month, day] = date.split('-').slice(1);
    
    const where = {
      businessId,
      active: true,
      [Op.or]: [
        { specificDate: date },
        { 
          isRecurringYearly: true,
          [Op.and]: [
            sequelize.where(
              sequelize.fn('EXTRACT', sequelize.literal('MONTH FROM "specificDate"')),
              parseInt(month)
            ),
            sequelize.where(
              sequelize.fn('EXTRACT', sequelize.literal('DAY FROM "specificDate"')),
              parseInt(day)
            )
          ]
        }
      ]
    };
    
    if (employeeId) {
      where.employeeId = { [Op.or]: [employeeId, null] };
    }
    
    const schedules = await SpecialSchedule.findAll({ where });
    return schedules;
  } catch (e) {
    console.error('Error obteniendo horarios especiales:', e);
    return [];
  }
};
