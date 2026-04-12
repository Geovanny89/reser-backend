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

// Crear empleado (soporta creación de usuario si se pasan name/email/password)
exports.create = async (req, res) => {
  try {
    const { businessId, userId, name, email, password, commissionPct, ownerPct, specialties, specialty, photoUrl, description } = req.body;
    
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
        status: { [Op.in]: ['pending', 'confirmed', 'attention', 'done'] }
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

// Obtener información del empleado con su negocio
exports.getEmployeeInfo = async (req, res) => {
  try {
    const userId = req.user.id;

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

    res.json(employee);
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
