const jwt = require('jsonwebtoken');
const { User, Business, Employee } = require('../../models');
const ActivityLog = require('../../models/ActivityLog');

function getRedirectUrlByRole(role) {
  switch (role) {
    case 'superadmin': return '/superadmin';
    case 'admin':
    case 'admin_suc': return '/admin';
    case 'employee': return '/employee';
    default: return '/my-appointments';
  }
}

async function impersonateUser(req, res) {
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
    await ActivityLog.create({
      userId: req.user.id,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'IMPERSONATE_USER',
      entityType: 'User',
      entityId: user.id,
      description: `SuperAdmin ingresó como: ${user.name} (${user.email}) - Rol: ${user.role}`,
      metadata: { 
        impersonatedUserRole: user.role,
        targetBusinessId: business?.id 
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
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
}

module.exports = {
  impersonateUser,
};
