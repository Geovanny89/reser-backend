const { EmployeeVacation, Employee, User, sequelize } = require('../models');
const { Op } = require('sequelize');

// Obtener vacaciones de un empleado específico
exports.getByEmployee = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const where = { employeeId: req.params.employeeId, active: true };
    
    if (startDate && endDate) {
      // Buscar vacaciones que se solapan con el rango proporcionado
      where[Op.or] = [
        { 
          startDate: { [Op.between]: [startDate, endDate] }
        },
        { 
          endDate: { [Op.between]: [startDate, endDate] }
        },
        {
          [Op.and]: [
            { startDate: { [Op.lte]: startDate } },
            { endDate: { [Op.gte]: endDate } }
          ]
        }
      ];
    }
    
    const vacations = await EmployeeVacation.findAll({
      where,
      order: [['startDate', 'ASC']],
      include: [{
        model: Employee,
        include: [{ model: User, attributes: ['name'] }]
      }]
    });
    
    res.json(vacations);
  } catch (e) {
    console.error('[EmployeeVacation] Error getByEmployee:', e);
    res.status(500).json({ error: e.message });
  }
};

// Obtener todas las vacaciones de un negocio
exports.getByBusiness = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const where = { businessId: req.params.businessId, active: true };
    
    if (startDate && endDate) {
      where[Op.or] = [
        { 
          startDate: { [Op.between]: [startDate, endDate] }
        },
        { 
          endDate: { [Op.between]: [startDate, endDate] }
        },
        {
          [Op.and]: [
            { startDate: { [Op.lte]: startDate } },
            { endDate: { [Op.gte]: endDate } }
          ]
        }
      ];
    }
    
    const vacations = await EmployeeVacation.findAll({
      where,
      order: [['startDate', 'ASC']],
      include: [{
        model: Employee,
        include: [{ model: User, attributes: ['name'] }]
      }]
    });
    
    res.json(vacations);
  } catch (e) {
    console.error('[EmployeeVacation] Error getByBusiness:', e);
    res.status(500).json({ error: e.message });
  }
};

// Crear nueva vacación
exports.create = async (req, res) => {
  try {
    const { employeeId, businessId, startDate, endDate, description } = req.body;
    
    if (!employeeId || !businessId || !startDate || !endDate) {
      return res.status(400).json({ 
        error: 'employeeId, businessId, startDate y endDate son requeridos' 
      });
    }
    
    // Validar que la fecha de inicio no sea posterior a la de fin
    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ 
        error: 'La fecha de inicio no puede ser posterior a la fecha de fin' 
      });
    }
    
    // Verificar si ya existe una vacación que se solape
    const existingVacation = await EmployeeVacation.findOne({
      where: {
        employeeId,
        active: true,
        [Op.or]: [
          {
            startDate: { [Op.lte]: endDate },
            endDate: { [Op.gte]: startDate }
          }
        ]
      }
    });
    
    if (existingVacation) {
      return res.status(400).json({ 
        error: 'Ya existe un período de vacaciones que se solapa con estas fechas para este empleado' 
      });
    }
    
    const vacation = await EmployeeVacation.create({
      employeeId,
      businessId,
      startDate,
      endDate,
      description: description || null,
      active: true
    });
    
    // Recuperar con relaciones
    const vacationWithRelations = await EmployeeVacation.findByPk(vacation.id, {
      include: [{
        model: Employee,
        include: [{ model: User, attributes: ['name'] }]
      }]
    });
    
    res.status(201).json(vacationWithRelations);
  } catch (e) {
    console.error('[EmployeeVacation] Error create:', e);
    res.status(400).json({ error: e.message });
  }
};

// Actualizar vacación
exports.update = async (req, res) => {
  try {
    const vacation = await EmployeeVacation.findByPk(req.params.id);
    if (!vacation) {
      return res.status(404).json({ error: 'Período de vacaciones no encontrado' });
    }
    
    const { startDate, endDate, description, active } = req.body;
    
    // Validar fechas si se proporcionan
    if (startDate && endDate) {
      if (new Date(startDate) > new Date(endDate)) {
        return res.status(400).json({ 
          error: 'La fecha de inicio no puede ser posterior a la fecha de fin' 
        });
      }
      
      // Verificar solapamiento con otras vacaciones (excluyendo la actual)
      const where = {
        id: { [Op.ne]: req.params.id },
        employeeId: vacation.employeeId,
        active: true,
        [Op.or]: [
          {
            startDate: { [Op.lte]: endDate || vacation.endDate },
            endDate: { [Op.gte]: startDate || vacation.startDate }
          }
        ]
      };
      
      const existingVacation = await EmployeeVacation.findOne({ where });
      
      if (existingVacation) {
        return res.status(400).json({ 
          error: 'Ya existe otro período de vacaciones que se solapa con estas fechas' 
        });
      }
    }
    
    await vacation.update({
      startDate: startDate || vacation.startDate,
      endDate: endDate || vacation.endDate,
      description: description !== undefined ? description : vacation.description,
      active: active !== undefined ? active : vacation.active
    });
    
    // Recuperar con relaciones
    const vacationWithRelations = await EmployeeVacation.findByPk(vacation.id, {
      include: [{
        model: Employee,
        include: [{ model: User, attributes: ['name'] }]
      }]
    });
    
    res.json(vacationWithRelations);
  } catch (e) {
    console.error('[EmployeeVacation] Error update:', e);
    res.status(400).json({ error: e.message });
  }
};

// Eliminar (desactivar) vacación
exports.remove = async (req, res) => {
  try {
    const vacation = await EmployeeVacation.findByPk(req.params.id);
    if (!vacation) {
      return res.status(404).json({ error: 'Período de vacaciones no encontrado' });
    }
    
    await vacation.update({ active: false });
    res.json({ message: 'Período de vacaciones eliminado' });
  } catch (e) {
    console.error('[EmployeeVacation] Error remove:', e);
    res.status(500).json({ error: e.message });
  }
};

// Verificar si un empleado está de vacaciones en una fecha específica (para usar en disponibilidad)
exports.isEmployeeOnVacation = async (employeeId, date) => {
  try {
    const count = await EmployeeVacation.count({
      where: {
        employeeId,
        active: true,
        startDate: { [Op.lte]: date },
        endDate: { [Op.gte]: date }
      }
    });
    
    return count > 0;
  } catch (e) {
    console.error('[EmployeeVacation] Error isEmployeeOnVacation:', e);
    return false;
  }
};

// Obtener empleados en vacaciones para una fecha específica
exports.getEmployeesOnVacationForDate = async (businessId, date) => {
  try {
    const vacations = await EmployeeVacation.findAll({
      where: {
        businessId,
        active: true,
        startDate: { [Op.lte]: date },
        endDate: { [Op.gte]: date }
      },
      include: [{
        model: Employee,
        include: [{ model: User, attributes: ['name'] }]
      }]
    });
    
    return vacations.map(v => v.employeeId);
  } catch (e) {
    console.error('[EmployeeVacation] Error getEmployeesOnVacationForDate:', e);
    return [];
  }
};
