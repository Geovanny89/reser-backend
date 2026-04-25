/**
 * Gestión de servicios de empleados - Versión Original
 */

const { Employee, Service, Business, EmployeeService, User } = require('../../models');
const { Op } = require('sequelize');

/**
 * Obtener servicios asignados a un empleado
 */
async function getEmployeeServices(req, res) {
  try {
    const { employeeId } = req.params;
    
    const employee = await Employee.findByPk(employeeId, {
      include: [
        { model: User, attributes: ['id', 'name', 'email'] },
        { 
          model: Service, 
          as: 'Services',
          attributes: ['id', 'name', 'description', 'price', 'durationMin', 'imageUrl'],
          through: { attributes: [] } // No incluir datos de la tabla pivote
        }
      ]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    res.json({
      employee: {
        id: employee.id,
        name: employee.User?.name,
        specialty: employee.specialty,
        photoUrl: employee.photoUrl
      },
      services: employee.Services || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Asignar servicios a un empleado (reemplaza todos)
 */
async function setEmployeeServices(req, res) {
  try {
    const { employeeId } = req.params;
    const { serviceIds } = req.body; // Array de IDs de servicios
    const businessId = req.body.businessId || req.query.businessId;

    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    if (!Array.isArray(serviceIds)) {
      return res.status(400).json({ error: 'serviceIds debe ser un array' });
    }

    const employee = await Employee.findOne({
      where: { id: employeeId, businessId }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Verificar que todos los servicios pertenecen al negocio
    const services = await Service.findAll({
      where: { 
        id: { [Op.in]: serviceIds },
        businessId 
      }
    });

    if (services.length !== serviceIds.length) {
      return res.status(400).json({ error: 'Algunos servicios no existen o no pertenecen a este negocio' });
    }

    // Eliminar relaciones existentes
    await EmployeeService.destroy({
      where: { employeeId }
    });

    // Crear nuevas relaciones
    if (serviceIds.length > 0) {
      const employeeServices = serviceIds.map(serviceId => ({
        employeeId,
        serviceId,
        businessId
      }));

      await EmployeeService.bulkCreate(employeeServices);
    }

    // Devolver empleado actualizado con sus servicios
    const updatedEmployee = await Employee.findByPk(employeeId, {
      include: [
        { model: User, attributes: ['id', 'name', 'email'] },
        { 
          model: Service, 
          as: 'Services',
          attributes: ['id', 'name', 'description', 'price', 'durationMin', 'imageUrl'],
          through: { attributes: [] }
        }
      ]
    });

    res.json({
      message: 'Servicios actualizados correctamente',
      employee: {
        id: updatedEmployee.id,
        name: updatedEmployee.User?.name,
        specialty: updatedEmployee.specialty
      },
      services: updatedEmployee.Services || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Agregar un servicio específico a un empleado
 */
async function addServiceToEmployee(req, res) {
  try {
    const { employeeId, serviceId } = req.params;
    const businessId = req.body.businessId || req.query.businessId;

    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    // Verificar que el empleado existe
    const employee = await Employee.findOne({
      where: { id: employeeId, businessId }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Verificar que el servicio existe y pertenece al negocio
    const service = await Service.findOne({
      where: { id: serviceId, businessId }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    // Verificar si ya existe la relación
    const existing = await EmployeeService.findOne({
      where: { employeeId, serviceId }
    });

    if (existing) {
      return res.status(400).json({ error: 'El empleado ya tiene asignado este servicio' });
    }

    // Crear la relación
    await EmployeeService.create({ employeeId, serviceId, businessId });

    res.json({ message: 'Servicio agregado al empleado correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Remover un servicio de un empleado
 */
async function removeServiceFromEmployee(req, res) {
  try {
    const { employeeId, serviceId } = req.params;
    const businessId = req.body.businessId || req.query.businessId;

    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    // Verificar que la relación existe
    const employeeService = await EmployeeService.findOne({
      where: { employeeId, serviceId, businessId }
    });

    if (!employeeService) {
      return res.status(404).json({ error: 'Relación no encontrada' });
    }

    await employeeService.destroy();

    res.json({ message: 'Servicio removido del empleado correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * Obtener empleados que pueden realizar un servicio específico
 */
async function getEmployeesByService(req, res) {
  try {
    const { serviceId } = req.params;
    const businessId = req.query.businessId;

    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    // Verificar que el servicio existe
    const service = await Service.findOne({
      where: { id: serviceId, businessId }
    });

    if (!service) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }

    const employees = await Employee.findAll({
      where: { businessId, active: true },
      include: [
        { model: User, attributes: ['id', 'name', 'email'] },
        {
          model: Service, 
          as: 'Services',
          where: { id: serviceId },
          required: true, // INNER JOIN - solo empleados que tienen este servicio
          attributes: [] // No necesitamos los datos del servicio
        }
      ]
    });

    res.json({
      service: {
        id: service.id,
        name: service.name
      },
      employees: employees.map(emp => ({
        id: emp.id,
        name: emp.User?.name,
        specialty: emp.specialty,
        photoUrl: emp.photoUrl,
        commissionPct: emp.commissionPct
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getEmployeeServices,
  setEmployeeServices,
  addServiceToEmployee,
  removeServiceFromEmployee,
  getEmployeesByService
};
