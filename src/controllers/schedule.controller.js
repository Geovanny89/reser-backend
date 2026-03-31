const { Schedule, Employee, User } = require('../models');

exports.getByEmployee = async (req, res) => {
  try {
    const schedules = await Schedule.findAll({
      where: { employeeId: req.params.employeeId, active: true },
      order: [['dayOfWeek', 'ASC']]
    });
    res.json(schedules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getByBusiness = async (req, res) => {
  try {
    const schedules = await Schedule.findAll({
      where: { businessId: req.params.businessId, active: true },
      include: [{ model: Employee, include: [{ model: User, attributes: ['name'] }] }],
      order: [['dayOfWeek', 'ASC']]
    });
    res.json(schedules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { employeeId, businessId, dayOfWeek, startTime, endTime, type, description } = req.body;
    const schedule = await Schedule.create({ 
      employeeId, 
      businessId, 
      dayOfWeek, 
      startTime, 
      endTime,
      type: type || 'work',
      description: description || null
    });
    res.status(201).json(schedule);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Horario no encontrado' });
    
    const { employeeId, businessId, dayOfWeek, startTime, endTime, type, description, active } = req.body;
    await schedule.update({ 
      employeeId, 
      businessId, 
      dayOfWeek, 
      startTime, 
      endTime,
      type,
      description,
      active
    });
    res.json(schedule);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const schedule = await Schedule.findByPk(req.params.id);
    if (!schedule) return res.status(404).json({ error: 'Horario no encontrado' });
    await schedule.update({ active: false });
    res.json({ message: 'Horario eliminado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
