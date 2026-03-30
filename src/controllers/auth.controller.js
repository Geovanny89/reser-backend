const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Business } = require('../models');
const { JWT_SECRET, JWT_EXPIRES } = require('../config/jwt');

exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });

    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ error: 'El email ya está registrado' });

    const hash = await bcrypt.hash(password, 10);
    const safeRole = ['admin', 'employee', 'client'].includes(role) ? role : 'client';
    const user = await User.create({ name, email, password: hash, role: safeRole });

    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// Registro de vendedor con datos del negocio
exports.registerVendor = async (req, res) => {
  try {
    const { name, email, password, businessName, businessType, description, phone, address } = req.body;
    
    // Validar campos requeridos
    if (!name || !email || !password || !businessName || !businessType)
      return res.status(400).json({ error: 'Todos los campos son requeridos' });

    // Verificar que el email no exista
    const exists = await User.findOne({ where: { email } });
    if (exists) return res.status(400).json({ error: 'El email ya está registrado' });

    // Crear usuario con rol admin
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ 
      name, 
      email, 
      password: hash, 
      role: 'admin' 
    });

    // Crear el negocio automáticamente con suscripción de 30 días
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);
    
    const business = await Business.create({
      name: businessName,
      type: businessType,
      description: description || '',
      phone: phone || '',
      address: address || '',
      ownerId: user.id,
      subscriptionStatus: 'paid',
      subscriptionStartDate: now,
      subscriptionEndDate: endDate
    });

    // Generar token JWT
    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.status(201).json({ 
      token,
      user: { 
        id: user.id, 
        name: user.name, 
        email: user.email, 
        role: user.role 
      },
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        type: business.type
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña son requeridos' });

    const user = await User.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    // Si es admin, obtener su negocio y verificar suscripción
    let business = null;
    let subscriptionDaysLeft = null;
    if (user.role === 'admin') {
      business = await Business.findOne({ where: { ownerId: user.id } });
      if (business && business.subscriptionEndDate) {
        const now = new Date();
        const endDate = new Date(business.subscriptionEndDate);
        const diffTime = endDate - now;
        subscriptionDaysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Bloquear si la suscripción venció
        if (subscriptionDaysLeft <= 0 && business.status !== 'blocked') {
          await business.update({ status: 'blocked' });
        }
      }
    }

    // Verificar si el usuario está bloqueado directamente
    if (user.status === 'blocked') {
      return res.status(403).json({ error: 'Tu cuenta está bloqueada, por favor paga la suscripción para seguir disfrutando de tus servicios' });
    }

    // Si es admin o empleado, verificar si el negocio está bloqueado
    if (user.role === 'admin' || user.role === 'employee') {
      let bizToCheck = business;
      if (user.role === 'employee') {
        const { Employee } = require('../models');
        const emp = await Employee.findOne({ where: { userId: user.id } });
        if (emp) {
          bizToCheck = await Business.findByPk(emp.businessId);
        }
      }

      if (bizToCheck && bizToCheck.status === 'blocked') {
        return res.status(403).json({ error: 'Tu cuenta está bloqueada, por favor paga la suscripción para seguir disfrutando de tus servicios' });
      }
    }

    res.json({ 
      token, 
      user: { 
        id: user.id, 
        name: user.name, 
        email: user.email, 
        role: user.role,
        status: user.status
      },
      business: business ? {
        id: business.id,
        name: business.name,
        slug: business.slug,
        type: business.type,
        status: business.status,
        subscriptionDaysLeft: subscriptionDaysLeft,
        subscriptionEndDate: business.subscriptionEndDate
      } : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.me = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si es admin, obtener su negocio y calcular días de suscripción
    let business = null;
    let subscriptionDaysLeft = null;
    if (user.role === 'admin') {
      business = await Business.findOne({ where: { ownerId: user.id } });
      if (business && business.subscriptionEndDate) {
        const now = new Date();
        const endDate = new Date(business.subscriptionEndDate);
        const diffTime = endDate - now;
        subscriptionDaysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
    }

    res.json({ 
      user,
      business: business ? {
        id: business.id,
        name: business.name,
        slug: business.slug,
        type: business.type,
        status: business.status,
        subscriptionStatus: business.subscriptionStatus,
        subscriptionEndDate: business.subscriptionEndDate,
        subscriptionDaysLeft: subscriptionDaysLeft
      } : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
