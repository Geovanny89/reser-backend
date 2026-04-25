const { User, Business, Employee, Appointment, Op } = require('../../models');
const bcrypt = require('bcryptjs');
const ActivityLog = require('../../models/ActivityLog');

async function getAllUsers(req, res) {
  try {
    const { search, role, status, page = 1, limit = 50 } = req.query;
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
}

async function getUserById(req, res) {
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
}

async function createUser(req, res) {
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
    await ActivityLog.create({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'CREATE_USER',
      entityType: 'User',
      entityId: user.id,
      description: `Usuario creado: ${name} (${email}) con rol ${role}`,
      newValues: { name, email, role, status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function updateUser(req, res) {
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
    await ActivityLog.create({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'UPDATE_USER',
      entityType: 'User',
      entityId: user.id,
      description: `Usuario actualizado: ${user.name} (${user.email})`,
      oldValues,
      newValues: { name: user.name, email: user.email, role: user.role, status: user.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      message: 'Usuario actualizado exitosamente',
      user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function toggleUserStatus(req, res) {
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
    await ActivityLog.create({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action,
      entityType: 'User',
      entityId: user.id,
      description: `Usuario ${newStatus === 'blocked' ? 'bloqueado' : 'desbloqueado'}: ${user.name} (${user.email})`,
      oldValues: { status: user.status === 'blocked' ? 'active' : 'blocked' },
      newValues: { status: newStatus },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      message: `Usuario ${newStatus === 'blocked' ? 'bloqueado' : 'desbloqueado'} exitosamente`,
      user: { id: user.id, status: newStatus }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function resetPassword(req, res) {
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
    await ActivityLog.create({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'RESET_PASSWORD',
      entityType: 'User',
      entityId: user.id,
      description: `Contraseña reseteada para: ${user.name} (${user.email})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      message: 'Contraseña actualizada exitosamente',
      tempPassword: newPassword
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function deleteUser(req, res) {
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
    await ActivityLog.create({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'DELETE_USER',
      entityType: 'User',
      entityId: id,
      description: `Usuario eliminado: ${userInfo.name} (${userInfo.email})`,
      oldValues: userInfo,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({ message: 'Usuario y empleado eliminados exitosamente' });
  } catch (e) {
    console.error('[deleteUser] Error:', e);
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  resetPassword,
  deleteUser,
};
