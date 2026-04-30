const { sequelize, User, Business, Employee, Appointment, ActivityLog, Op } = require('../models');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { logActivity } = require('../utils/activityLogger');

// ==================== USUARIOS ====================

// Listar todos los usuarios con información relacionada
exports.getAllUsers = async (req, res) => {
  try {
    const { search, role, status, page = 1, limit = 10 } = req.query;
    const where = {};
    
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }
    if (role) where.role = role;
    if (status) where.status = status;

    const offset = (page - 1) * limit;
    
    const { count, rows: users } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      include: [
        { 
          model: Business, 
          as: 'Businesses', 
          attributes: ['id', 'name', 'status', 'subscriptionStatus'],
          required: false
        },
        {
          model: Employee,
          attributes: ['id', 'businessId', 'isManager'],
          required: false,
          include: [
            { 
              model: Business, 
              attributes: ['id', 'name'],
              required: false
            }
          ]
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      users,
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
};

// Obtener detalle de un usuario
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] },
      include: [
        { 
          model: Business, 
          as: 'Businesses',
          include: [
            { 
              model: Business, 
              as: 'Branches',
              attributes: ['id', 'name', 'status']
            }
          ]
        },
        {
          model: Employee,
          include: [{ model: Business, attributes: ['id', 'name', 'status'] }]
        }
      ]
    });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Estadísticas adicionales
    const stats = {};
    
    if (user.role === 'client') {
      stats.appointmentsCount = await Appointment.count({ where: { clientId: id } });
    }
    
    if (user.role === 'employee' || user.role === 'admin_suc') {
      const employee = await Employee.findOne({ where: { userId: id } });
      if (employee) {
        stats.appointmentsCount = await Appointment.count({ where: { employeeId: employee.id } });
      }
    }

    res.json({ user, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Crear nuevo usuario
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role = 'client', status = 'active' } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
    }

    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ error: 'El email ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hash,
      role,
      status
    });

    // Registrar actividad
    logActivity({ user: req.user }, {
      action: 'CREATE_USER',
      entityType: 'User',
      entityId: user.id,
      description: `Usuario creado: ${name} (${email}) con rol ${role}`,
      newValues: { name, email, role, status }
    });

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Actualizar usuario
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, status } = req.body;
    
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const oldValues = { name: user.name, email: user.email, role: user.role, status: user.status };

    // Verificar si el email ya está en uso por otro usuario
    if (email && email !== user.email) {
      const exists = await User.findOne({ where: { email } });
      if (exists) return res.status(400).json({ error: 'El email ya está registrado' });
    }

    await user.update({
      name: name || user.name,
      email: email || user.email,
      role: role || user.role,
      status: status || user.status
    });

    // Registrar actividad
    logActivity({ user: req.user }, {
      action: 'UPDATE_USER',
      entityType: 'User',
      entityId: user.id,
      description: `Usuario actualizado: ${user.name} (${user.email})`,
      oldValues,
      newValues: { name: user.name, email: user.email, role: user.role, status: user.status }
    });

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Bloquear/Desbloquear usuario
exports.toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'No se puede bloquear a un superadmin' });
    }

    const newStatus = user.status === 'active' ? 'blocked' : 'active';
    const action = newStatus === 'blocked' ? 'BLOCK_USER' : 'UNBLOCK_USER';
    
    await user.update({ status: newStatus });

    // Registrar actividad
    logActivity({ user: req.user }, {
      action,
      entityType: 'User',
      entityId: user.id,
      description: `Usuario ${newStatus === 'blocked' ? 'bloqueado' : 'desbloqueado'}: ${user.name} (${user.email})`,
      oldValues: { status: user.status === 'blocked' ? 'active' : 'blocked' },
      newValues: { status: newStatus }
    });


    res.json({
      message: `Usuario ${newStatus === 'blocked' ? 'bloqueado' : 'desbloqueado'} exitosamente`,
      user: { id: user.id, status: newStatus }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Resetear contraseña
exports.resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const hash = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hash });

    // Registrar actividad
    logActivity({ user: req.user }, {
      action: 'RESET_PASSWORD',
      entityType: 'User',
      entityId: user.id,
      description: `Contraseña reseteada para: ${user.name} (${user.email})`
    });


    res.json({
      message: 'Contraseña actualizada exitosamente',
      tempPassword: newPassword
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Eliminar usuario
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    
    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'No se puede eliminar un superadmin' });
    }

    const userInfo = { name: user.name, email: user.email, role: user.role };
    
    // Primero eliminar el empleado asociado si existe (para evitar error de clave foránea)
    const employee = await Employee.findOne({ where: { userId: id } });
    if (employee) {
      await employee.destroy();
    }
    
    // Luego eliminar el usuario
    await user.destroy();

    // Registrar actividad
    logActivity({ user: req.user }, {
      action: 'DELETE_USER',
      entityType: 'User',
      entityId: id,
      description: `Usuario eliminado: ${userInfo.name} (${userInfo.email})`,
      oldValues: userInfo
    });


    res.json({ message: 'Usuario y empleado eliminados exitosamente' });
  } catch (e) {
    console.error('[deleteUser] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// ==================== IMPERSONACIÓN ====================

// Login como otro usuario (impersonación)
exports.impersonateUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findByPk(id, {
      include: [
        { model: Business, as: 'Businesses' },
        { 
          model: Employee, 
          include: [{ model: Business }]
        }
      ]
    });
    
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.status === 'blocked') {
      return res.status(403).json({ error: 'Este usuario está bloqueado' });
    }

    // Generar token JWT como el usuario objetivo
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        name: user.name,
        isImpersonated: true,
        impersonatedBy: req.user.id
      },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );

    // Preparar datos del negocio según el rol
    let business = null;
    let isManager = false;

    if (user.role === 'admin' && user.Businesses && user.Businesses.length > 0) {
      business = user.Businesses[0];
    } else if ((user.role === 'employee' || user.role === 'admin_suc')) {
      // Employee puede venir como array (Employees) o singular (Employee)
      const employee = Array.isArray(user.Employees) ? user.Employees[0] : (user.Employee || user.Employees);
      if (employee) {
        business = employee.Business;
        isManager = employee.isManager;
      }
    }

    // Calcular días restantes de suscripción
    let subscriptionDays = 0;
    if (business && business.subscriptionEndDate) {
      const end = new Date(business.subscriptionEndDate);
      const now = new Date();
      subscriptionDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    }

    // Registrar actividad
    logActivity({ user: req.user }, {
      action: 'IMPERSONATE_USER',
      entityType: 'User',
      entityId: user.id,
      description: `SuperAdmin ingresó como: ${user.name} (${user.email}) - Rol: ${user.role}`,
      businessId: business?.id,
      metadata: { 
        impersonatedUserRole: user.role,
        targetBusinessId: business?.id 
      }
    });


    res.json({
      message: `Ingresando como ${user.name}`,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isImpersonated: true
      },
      business: business ? {
        id: business.id,
        name: business.name,
        subscriptionStatus: business.subscriptionStatus,
        subscriptionDays: subscriptionDays > 0 ? subscriptionDays : 0,
        isBlocked: business.status === 'blocked'
      } : null,
      isManager,
      redirectUrl: getRedirectUrlByRole(user.role)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

function getRedirectUrlByRole(role) {
  switch (role) {
    case 'superadmin': return '/superadmin';
    case 'admin':
    case 'admin_suc': return '/admin';
    case 'employee': return '/employee';
    default: return '/my-appointments';
  }
}

// ==================== ACTIVITY LOGS ====================

// Obtener logs de actividad
exports.getActivityLogs = async (req, res) => {
  try {
    const { 
      userId, 
      action, 
      entityType, 
      startDate, 
      endDate, 
      businessId,
      page = 1, 
      limit = 10 
    } = req.query;
    
    const where = {};
    
    if (userId) where.userId = userId;
    if (businessId) where.businessId = businessId;
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
        },
        {
          model: Business,
          as: 'Business',
          attributes: ['id', 'name'],
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
    console.error('❌ [getActivityLogs] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// Obtener estadísticas de logs
exports.getActivityStats = async (req, res) => {
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
};

// ==================== REPORTES GLOBALES ====================

// Reporte financiero global
exports.getGlobalFinancialReport = async (req, res) => {
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

    // Revenue por negocio (GMV - Lo que mueven los negocios)
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

    // Ingresos reales de la PLATAFORMA (Lo que te pagan a ti)
    const platformRevenue = await Business.sum('paymentAmount', {
      where: {
        subscriptionStatus: 'paid',
        ...(startDate || endDate ? { lastPaymentDate: dateFilter } : {})
      }
    }) || 0;

    res.json({
      summary: {
        totalAppointments: appointments.length,
        totalGmv: totalRevenue, // Gross Merchandise Value (Ventas de los negocios)
        platformRevenue,       // Tus ganancias reales por suscripciones
        averagePerAppointment: appointments.length > 0 ? totalRevenue / appointments.length : 0
      },
      byStatus,
      byBusiness
    });
  } catch (e) {
    console.error('❌ [getGlobalFinancialReport] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// Estadísticas globales del sistema
exports.getGlobalStats = async (req, res) => {
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
    console.error('❌ [getGlobalStats] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
