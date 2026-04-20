const { Employee, User, Appointment, Service, Schedule, Business } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const { deleteFromCloudinary } = require('../config/cloudinary');

exports.getByBusiness = async (req, res) => {
  try {
    const businessId = req.params.businessId || req.query.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    const employees = await Employee.findAll({
      where: { businessId, active: true },
      include: [
        { model: User, attributes: ['id', 'name', 'email'] },
        { 
          model: Appointment, 
          attributes: ['id', 'rating', 'clientName', 'updatedAt', 'status'],
          required: false
        },
        {
          model: Service,
          as: 'Services',
          attributes: ['id', 'name', 'price', 'durationMin', 'imageUrl'],
          through: { attributes: [] },
          required: false
        }
      ],
      order: [
        ['id', 'ASC'],
        [{ model: Appointment }, 'updatedAt', 'DESC']
      ]
    });

    // Calcular estadísticas para cada empleado
    const employeesWithStats = employees.map(emp => {
      // Filtrar manualmente solo las que tienen rating para las estadísticas y reseñas
      const allAppointments = emp.Appointments || [];
      const ratedAppointments = allAppointments.filter(a => a.rating != null && a.rating !== '');
      
      const totalRatings = ratedAppointments.length;
      const ratings = ratedAppointments.map(a => a.rating);
      
      const avgRating = totalRatings > 0 
        ? (ratings.reduce((sum, r) => sum + r, 0) / totalRatings).toFixed(1)
        : null;
      
      // Contar distribución de estrellas
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      ratings.forEach(r => {
        if (distribution[r] !== undefined) distribution[r]++;
      });

      // Obtener TODAS las reseñas detalladas
      const reviews = ratedAppointments.map(a => ({
        id: a.id,
        clientName: a.clientName || 'Cliente Anónimo',
        rating: a.rating,
        date: a.updatedAt
      }));

      const empJson = emp.toJSON();
      delete empJson.Appointments; 
      return {
        ...empJson,
        stats: {
          avgRating: avgRating ? parseFloat(avgRating) : null,
          totalRatings,
          distribution,
          reviews
        }
      };
    });

    res.json(employeesWithStats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Helper para verificar límite de empleados (el dueño/admin NO cuenta)
async function checkUserLimit(businessId) {
  const business = await Business.findByPk(businessId);
  if (!business) return { allowed: false, error: 'Negocio no encontrado' };
  
  const maxUsers = business.includedUsers + business.additionalUsers;
  const currentEmployees = await Employee.count({ 
    where: { businessId, active: true } 
  });
  
  // El dueño/admin NO cuenta en el límite, solo contamos empleados
  
  if (currentEmployees >= maxUsers) {
    return { 
      allowed: false, 
      error: `Has alcanzado el límite de ${maxUsers} empleados. Contrata más empleados para continuar.`,
      current: currentEmployees,
      max: maxUsers
    };
  }
  
  return { allowed: true, current: currentEmployees, max: maxUsers };
}

// Crear empleado (soporta creación de usuario si se pasan name/email/password)
exports.create = async (req, res) => {
  try {
    const { businessId, userId, name, email, password, commissionPct, ownerPct, specialties, specialty, photoUrl, description } = req.body;
    
    // Verificar límite de usuarios
    const limitCheck = await checkUserLimit(businessId);
    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: limitCheck.error,
        currentUsers: limitCheck.current,
        maxUsers: limitCheck.max,
        upgradeRequired: true
      });
    }
    
    let finalUserId = userId;
    let tempPassword = null;

    // Si no hay userId pero hay datos de usuario, crearlo
    if (!finalUserId && email && name) {
      const exists = await User.findOne({ where: { email } });
      if (exists) return res.status(400).json({ error: 'El email ya está registrado' });

      tempPassword = password || Math.random().toString(36).slice(-8);
      const hash = await bcrypt.hash(tempPassword, 10);
      
      const user = await User.create({
        name,
        email,
        password: hash,
        role: ['admin', 'admin_suc'].includes(req.body.role) ? req.body.role : 'employee'
      });
      finalUserId = user.id;
    }

    if (!finalUserId) return res.status(400).json({ error: 'userId o datos de nuevo usuario son requeridos' });

    const emp = await Employee.create({ 
      businessId, 
      userId: finalUserId, 
      commissionPct: commissionPct || 0, 
      ownerPct: ownerPct || 100, 
      specialties: specialties || [],
      specialty: specialty || null,
      photoUrl: photoUrl || null,
      description: description || null,
      isManager: req.body.isManager === true || req.body.isManager === 'true'
    });

    res.status(201).json({
      ...emp.toJSON(),
      tempPassword // Devolver para mostrar al admin si se creó
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// Invitar empleado (crear usuario + empleado)
exports.invite = async (req, res) => {
  try {
    const { name, email, commissionPct, ownerPct, specialties, specialty, photoUrl, description, businessId } = req.body;
    const adminId = req.user.id; // ID del admin autenticado

    // Si viene businessId, lo usamos. Si no, buscamos por owner (comportamiento anterior)
    let finalBusinessId = businessId;

    if (!finalBusinessId) {
      let business = await Business.findOne({ where: { ownerId: adminId } });
      
      // Si no es el dueño, buscar si es un admin_suc de una sucursal
      if (!business && req.user.role === 'admin_suc') {
        const emp = await Employee.findOne({ where: { userId: adminId, isManager: true } });
        if (emp) business = await Business.findByPk(emp.businessId);
      }

      if (!business) {
        return res.status(404).json({ error: 'No tienes un negocio asociado' });
      }
      finalBusinessId = business.id;
    }
    
    // Verificar límite de usuarios
    const limitCheck = await checkUserLimit(finalBusinessId);
    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: limitCheck.error,
        currentUsers: limitCheck.current,
        maxUsers: limitCheck.max,
        upgradeRequired: true
      });
    }

    // Validar que el email no exista
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ error: 'El email ya está registrado' });

    // Generar contraseña temporal
    const tempPassword = Math.random().toString(36).slice(-8);
    const hash = await bcrypt.hash(tempPassword, 10);

    // Crear usuario con rol employee
    const user = await User.create({
      name,
      email,
      password: hash,
      role: 'employee'
    });

    // Crear empleado con el businessId
    const employee = await Employee.create({
      businessId: finalBusinessId,
      userId: user.id,
      commissionPct: commissionPct || 0,
      ownerPct: ownerPct || 100,
      specialties: specialties || [],
      specialty: specialty || null,
      photoUrl: photoUrl || null,
      description: description || null
    });

    res.status(201).json({
      employee,
      user: { id: user.id, name: user.name, email: user.email },
      tempPassword // Enviar contraseña temporal (en producción, enviar por email)
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const emp = await Employee.findByPk(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    
    // ELIMINAR DE CLOUDINARY SI CAMBIA LA FOTO
    if (req.body.photoUrl && emp.photoUrl && req.body.photoUrl !== emp.photoUrl) {
      await deleteFromCloudinary(emp.photoUrl);
    }

    // ACTUALIZAR EMAIL Y NOMBRE DEL USUARIO ASOCIADO SI SE PROPORCIONAN
    if (req.body.email || req.body.name) {
      const user = await User.findByPk(emp.userId);
      if (user) {
        // Verificar si el email ya existe (y no es del mismo usuario)
        if (req.body.email && req.body.email !== user.email) {
          const existingUser = await User.findOne({ where: { email: req.body.email } });
          if (existingUser) {
            return res.status(400).json({ error: 'Este correo electrónico ya está registrado por otro usuario' });
          }
        }
        
        const userUpdates = {};
        if (req.body.email) userUpdates.email = req.body.email;
        if (req.body.name) userUpdates.name = req.body.name;
        await user.update(userUpdates);
      }
    }

    // Filtrar solo los campos de Employee (quitar email y name que son de User)
    const employeeUpdates = { ...req.body };
    delete employeeUpdates.email;
    delete employeeUpdates.name;

    // ELIMINAR FOTO ANTERIOR DE CLOUDINARY SI CAMBIA
    if (employeeUpdates.photoUrl && emp.photoUrl && employeeUpdates.photoUrl !== emp.photoUrl) {
      await deleteFromCloudinary(emp.photoUrl);
    }

    await emp.update(employeeUpdates);
    
    // Devolver empleado actualizado con datos del usuario
    const updatedEmp = await Employee.findByPk(req.params.id, {
      include: [{ model: User, attributes: ['id', 'name', 'email'] }]
    });
    
    res.json(updatedEmp);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const emp = await Employee.findByPk(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    await emp.update({ active: false });
    res.json({ message: 'Empleado desactivado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Obtener agenda del empleado para hoy
exports.getTodayAppointments = async (req, res) => {
  try {
    const employeeId = req.params.employeeId;
    // Forzar fecha actual en Colombia (UTC-5)
    const today = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const appointments = await Appointment.findAll({
      where: {
        employeeId,
        startTime: { [Op.between]: [today, tomorrow] },
        status: { [Op.in]: ['pending', 'confirmed', 'attention'] }
      },
      include: [
        { model: Service, attributes: ['name', 'price', 'durationMin'] },
        { model: Business, attributes: ['name', 'slug'] }
      ],
      order: [['startTime', 'ASC']]
    });

    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Obtener agenda del empleado para un rango de fechas
exports.getAppointmentsByDateRange = async (req, res) => {
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

    // Ordenar en JavaScript: pendientes primero, luego en atención, luego completadas/canceladas al final
    const statusOrder = { pending: 1, confirmed: 2, attention: 3, done: 4, cancelled: 5 };
    appointments.sort((a, b) => {
      const orderDiff = (statusOrder[a.status] || 6) - (statusOrder[b.status] || 6);
      if (orderDiff !== 0) return orderDiff;
      return new Date(a.startTime) - new Date(b.startTime);
    });

    res.json(appointments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Obtener información del empleado con su negocio
exports.getEmployeeInfo = async (req, res) => {
  try {
    const userId = req.user.id;

    const employee = await Employee.findOne({
      where: { userId },
      include: [
        { model: User, attributes: ['id', 'name', 'email'] },
        { model: Business, attributes: ['id', 'name', 'slug', 'type', 'logoUrl', 'isTechnicalServices', 'hasFieldTechnicians'] },
        { 
          model: Service, 
          as: 'Services',
          attributes: ['id', 'name', 'price', 'durationMin', 'imageUrl'],
          through: { attributes: [] }
        }
      ]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    res.json({
      id: employee.id,
      businessId: employee.businessId,
      commissionPct: employee.commissionPct,
      ownerPct: employee.ownerPct,
      specialty: employee.specialty,
      specialties: employee.specialties,
      photoUrl: employee.photoUrl,
      description: employee.description,
      active: employee.active,
      isManager: employee.isManager,
      user: employee.User,
      business: employee.Business,
      services: employee.Services || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Actualizar perfil del empleado logueado
exports.updateMyProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { specialty, description, photoUrl, specialties } = req.body;

    const employee = await Employee.findOne({
      where: { userId },
      include: [
        { model: User, attributes: ['id', 'name', 'email'] },
        { model: Business, attributes: ['id', 'name', 'slug', 'type'] }
      ]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Solo permitir actualizar ciertos campos
    const updates = {};
    if (specialty !== undefined) updates.specialty = specialty;
    if (description !== undefined) updates.description = description;
    if (photoUrl !== undefined) updates.photoUrl = photoUrl;
    if (specialties !== undefined) updates.specialties = specialties;

    await employee.update(updates);

    res.json({
      message: 'Perfil actualizado correctamente',
      employee: {
        id: employee.id,
        specialty: employee.specialty,
        specialties: employee.specialties,
        photoUrl: employee.photoUrl,
        description: employee.description,
        user: employee.User,
        business: employee.Business
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

const startOfMonth = (monthStr) => {
  // Crear fecha en zona horaria Colombia (UTC-5)
  const d = new Date(monthStr + '-01T00:00:00-05:00');
  return d;
};

const endOfMonth = (monthStr) => {
  // Crear fecha en zona horaria Colombia (UTC-5)
  const d = new Date(monthStr + '-01T00:00:00-05:00');
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  d.setHours(23, 59, 59, 999);
  return d;
};

// ========== GESTIÓN DE SERVICIOS POR EMPLEADO ==========

const { EmployeeService } = require('../models');

// Obtener servicios asignados a un empleado
exports.getEmployeeServices = async (req, res) => {
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
};

// Asignar servicios a un empleado (reemplaza todos los existentes)
exports.setEmployeeServices = async (req, res) => {
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
};

// Agregar un servicio específico a un empleado
exports.addServiceToEmployee = async (req, res) => {
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
};

// Remover un servicio de un empleado
exports.removeServiceFromEmployee = async (req, res) => {
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
};

// Obtener empleados que pueden realizar un servicio específico
exports.getEmployeesByService = async (req, res) => {
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
};

// ========== COMISIONES PARA EMPLEADO (Ver sus propias comisiones) ==========

// Helpers para fechas en zona horaria Colombia
const getColombiaDate = (date = new Date()) => {
  return new Date(date.toLocaleString("en-US", {timeZone: "America/Bogota"}));
};

const startOfDay = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00-05:00');
  return d;
};

const endOfDay = (dateStr) => {
  const d = new Date(dateStr + 'T23:59:59.999-05:00');
  return d;
};

const startOfWeek = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00-05:00');
  const day = d.getDay(); // 0 = domingo, 1 = lunes, etc.
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Ajustar para que la semana empiece en lunes
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfWeek = (dateStr) => {
  const start = startOfWeek(dateStr);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
};

exports.getMyCommissions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { view = 'month', date, page = 1, limit = 8 } = req.query;
    // view: 'day' | 'week' | 'month'
    // date: YYYY-MM-DD para day/week, YYYY-MM para month

    // Buscar el empleado asociado al usuario
    const employee = await Employee.findOne({
      where: { userId, active: true },
      include: [{ model: User, attributes: ['name', 'email'] }]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Determinar rango de fechas según la vista
    const now = getColombiaDate();
    let start, end, periodLabel;

    if (view === 'day') {
      const targetDate = date || now.toISOString().slice(0, 10); // YYYY-MM-DD
      start = startOfDay(targetDate);
      end = endOfDay(targetDate);
      periodLabel = targetDate;
    } else if (view === 'week') {
      const targetDate = date || now.toISOString().slice(0, 10);
      start = startOfWeek(targetDate);
      end = endOfWeek(targetDate);
      const endStr = end.toISOString().slice(0, 10);
      periodLabel = `${start.toISOString().slice(0, 10)} a ${endStr}`;
    } else {
      // month (default)
      const targetMonth = date || now.toISOString().slice(0, 7); // YYYY-MM
      start = startOfMonth(targetMonth);
      end = endOfMonth(targetMonth);
      periodLabel = targetMonth;
    }

    // Obtener info del negocio primero
    const business = await Business.findByPk(employee.businessId);
    const isTechnicalServices = business?.isTechnicalServices || false;
    const hasFieldTechnicians = business?.hasFieldTechnicians || false;

    // Para técnicos de campo, traemos TODAS las citas. Para otros, solo completadas.
    const appointmentWhere = {
      employeeId: employee.id,
      startTime: { [Op.between]: [start, end] }
    };
    
    // Si NO es técnico de campo, filtrar solo citas completadas
    if (!hasFieldTechnicians) {
      appointmentWhere.status = 'done';
    }

    // Buscar citas del empleado en el período
    const allAppointments = await Appointment.findAll({
      where: appointmentWhere,
      include: [
        { model: Service, attributes: ['name', 'price', 'hasEmployeeCommission'] },
        { model: Business, attributes: ['name', 'isTechnicalServices'] }
      ],
      order: [['startTime', 'DESC']]
    });

    const commissionPct = (isTechnicalServices || hasFieldTechnicians) ? 0 : (parseFloat(employee.commissionPct) || 0);

    // Calcular reporte completo para totales
    const allReport = allAppointments.map(appt => {
      const basePrice = parseFloat(appt.Service.price) || 0;
      const additional = parseFloat(appt.additionalAmount) || 0;
      const totalPrice = basePrice + additional;
      
      // En servicios técnicos o técnicos de campo no hay comisiones ni precios
      const hideMoney = isTechnicalServices || hasFieldTechnicians;
      const hasCommission = hideMoney ? false : (appt.Service.hasEmployeeCommission !== false);
      const myCommission = hasCommission ? (totalPrice * commissionPct / 100) : 0;
      
      return {
        id: appt.id,
        date: appt.startTime,
        service: appt.Service.name,
        client: appt.clientName,
        clientPhone: appt.clientPhone,
        status: appt.status,
        technicianStatus: appt.technicianStatus,
        price: hideMoney ? 0 : totalPrice,
        basePrice: hideMoney ? 0 : basePrice,
        additional: hideMoney ? 0 : additional,
        myCommission: hideMoney ? 0 : parseFloat(myCommission.toFixed(2)),
        commissionPct: hasCommission ? commissionPct : 0,
        hasCommission: hasCommission,
        paymentMethod: appt.paymentMethod,
        isTechnicalService: appt.Service.isTechnicalService || false
      };
    });

    // Totales de todas las citas en el período
    const totals = allReport.reduce((acc, r) => ({
      totalServices:   acc.totalServices + r.price,
      totalCommission: acc.totalCommission + r.myCommission,
      count:           acc.count + 1
    }), { totalServices: 0, totalCommission: 0, count: 0 });

    totals.totalServices = parseFloat(totals.totalServices.toFixed(2));
    totals.totalCommission = parseFloat(totals.totalCommission.toFixed(2));

    // Para técnicos de campo, obtener estadísticas por estado (pending, confirmed, done, cancelled)
    let statusStats = null;
    if (hasFieldTechnicians) {
      const allStatusAppointments = await Appointment.findAll({
        where: {
          employeeId: employee.id,
          startTime: { [Op.between]: [start, end] }
        },
        attributes: ['status']
      });
      
      statusStats = {
        pending: allStatusAppointments.filter(a => a.status === 'pending').length,
        confirmed: allStatusAppointments.filter(a => a.status === 'confirmed').length,
        attention: allStatusAppointments.filter(a => a.status === 'attention').length,
        done: allStatusAppointments.filter(a => a.status === 'done').length,
        cancelled: allStatusAppointments.filter(a => a.status === 'cancelled').length,
        total: allStatusAppointments.length
      };
    }

    // Paginación
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;
    const totalPages = Math.ceil(allReport.length / limitNum);
    const paginatedAppointments = allReport.slice(offset, offset + limitNum);

    res.json({
      view,
      period: periodLabel,
      periodStart: start,
      periodEnd: end,
      isTechnicalServices,
      hasFieldTechnicians,
      statusStats,
      employee: {
        id: employee.id,
        name: employee.User?.name,
        commissionPct: commissionPct,
        specialty: employee.specialty
      },
      appointments: paginatedAppointments,
      totals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: allReport.length,
        totalPages: totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getCommissionReport = async (req, res) => {
  try {
    const businessId = req.query.businessId || req.params.businessId;
    const { month } = req.query;
    console.log('🔍 Backend recibió month:', month); // DEBUG
    
    if (!businessId || !month)
      return res.status(400).json({ error: 'businessId y month (YYYY-MM) son requeridos' });

    const start = startOfMonth(month);
    const end = endOfMonth(month);
    console.log('🔍 Buscando citas entre:', start, 'y', end); // DEBUG

    const appointments = await Appointment.findAll({
      where: {
        businessId,
        status: 'done', // Solo citas completadas generan ingresos
        startTime: { [Op.between]: [startOfMonth(month), endOfMonth(month)] }
      },
      include: [
        { model: Service },
        { 
          model: Employee, 
          required: true,
          include: [{ model: User, attributes: ['name'], required: true }] 
        }
      ]
    });

    const report = appointments.map(appt => {
      const basePrice = parseFloat(appt.Service.price) || 0;
      const additional = parseFloat(appt.additionalAmount) || 0;
      const totalPrice = basePrice + additional;
      
      const hasCommission = appt.Service.hasEmployeeCommission !== false; // Default true
      const commissionPct = hasCommission ? (parseFloat(appt.Employee.commissionPct) || 0) : 0;
      const ownerPct = hasCommission ? (parseFloat(appt.Employee.ownerPct) || 100) : 100;
      
      return {
        date:          appt.startTime,
        service:       appt.Service.name,
        client:        appt.clientName,
        price:         totalPrice, // Precio total (base + adicional)
        basePrice:     basePrice,
        additional:    additional,
        employee:      appt.Employee.User.name,
        employeeEarns: (totalPrice * commissionPct / 100).toFixed(2),
        ownerEarns:    (totalPrice * ownerPct / 100).toFixed(2),
        hasCommission: hasCommission,
      };
    });

    const totals = report.reduce((acc, r) => ({
      total:         acc.total + parseFloat(r.price),
      employeeTotal: acc.employeeTotal + parseFloat(r.employeeEarns),
      ownerTotal:    acc.ownerTotal + parseFloat(r.ownerEarns),
    }), { total: 0, employeeTotal: 0, ownerTotal: 0 });

    // Redondear totales a 2 decimales
    totals.total = parseFloat(totals.total.toFixed(2));
    totals.employeeTotal = parseFloat(totals.employeeTotal.toFixed(2));
    totals.ownerTotal = parseFloat(totals.ownerTotal.toFixed(2));

    res.json({ appointments: report, totals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// ========== CALIFICACIONES DEL EMPLEADO ==========

exports.getMyRatings = async (req, res) => {
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
};

// ========== CLIENTES FRECUENTES ==========

exports.getMyFrequentClients = async (req, res) => {
  try {
    const userId = req.user.id;

    const employee = await Employee.findOne({
      where: { userId, active: true },
      include: [{ model: User, attributes: ['name', 'email'] }]
    });

    if (!employee) {
      return res.status(404).json({ error: 'Empleado no encontrado' });
    }

    // Buscar todas las citas completadas
    const appointments = await Appointment.findAll({
      where: {
        employeeId: employee.id,
        status: 'done'
      },
      include: [
        { model: Service, attributes: ['name', 'price'] }
      ],
      order: [['startTime', 'DESC']]
    });

    // Agrupar por cliente
    const clientMap = new Map();
    
    appointments.forEach(apt => {
      const key = apt.clientPhone || apt.clientEmail || apt.clientName;
      if (!key) return;
      
      if (!clientMap.has(key)) {
        clientMap.set(key, {
          name: apt.clientName,
          phone: apt.clientPhone,
          email: apt.clientEmail,
          visits: 0,
          totalSpent: 0,
          lastVisit: null,
          services: new Set()
        });
      }
      
      const client = clientMap.get(key);
      client.visits++;
      const price = parseFloat(apt.Service?.price) || 0;
      const additional = parseFloat(apt.additionalAmount) || 0;
      client.totalSpent += price + additional;
      client.services.add(apt.Service.name);
      
      if (!client.lastVisit || new Date(apt.startTime) > new Date(client.lastVisit)) {
        client.lastVisit = apt.startTime;
      }
    });

    // Convertir a array y ordenar por visitas
    const clients = Array.from(clientMap.values())
      .map(c => ({
        ...c,
        services: Array.from(c.services),
        totalSpent: parseFloat(c.totalSpent.toFixed(2))
      }))
      .sort((a, b) => b.visits - a.visits);

    res.json({
      totalClients: clients.length,
      clients: clients.slice(0, 50) // Limitar a 50 clientes más frecuentes
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
