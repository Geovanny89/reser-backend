const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Business } = require('../models');
const { JWT_SECRET, JWT_EXPIRES } = require('../config/jwt');
const { sendEmail } = require('../config/email');

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
      return res.status(403).json({ error: 'Usuario bloqueado, por favor consulte al administrador' });
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

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'El email es requerido' });

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: 'No existe un usuario con ese correo electrónico' });
    }

    if (user.role === 'client') {
      return res.status(403).json({ error: 'Acceso denegado para cuentas de cliente' });
    }

    // Generar un token de recuperación único
    const resetToken = jwt.sign(
      { id: user.id, purpose: 'password-reset' },
      JWT_SECRET,
      { expiresIn: '1h' } // El enlace expira en 1 hora
    );

    // Construir la URL de recuperación (usando la variable de entorno FRONTEND_URL)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Enviar email con el ENLACE para restablecer la contraseña
    await sendEmail(user.email, 'forgotPassword', {
      name: user.name,
      resetUrl: resetUrl
    });

    res.json({ message: 'Se ha enviado un enlace para restablecer tu contraseña a tu correo electrónico' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token y nueva contraseña son requeridos' });
    }

    // Verificar el token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'El enlace ha expirado o es inválido' });
    }

    if (decoded.purpose !== 'password-reset') {
      return res.status(401).json({ error: 'Token inválido' });
    }

    const user = await User.findByPk(decoded.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const hash = await bcrypt.hash(newPassword, 10);
    await user.update({ password: hash });

    res.json({ message: 'Contraseña restablecida correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'La contraseña actual es incorrecta' });

    const hash = await bcrypt.hash(newPassword, 10);
    
    // Update using save() to ensure it persists
    user.password = hash;
    await user.save();
    
    console.log(`[Auth] Contraseña cambiada para usuario ${user.email}`);
    console.log(`[Auth] Nuevo hash: ${hash.substring(0, 20)}...`);

    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (e) {
    console.error('[Auth] Error cambiando contraseña:', e);
    res.status(500).json({ error: e.message });
  }
};

// Actualizar token FCM para notificaciones push
exports.updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user.id;

    if (!fcmToken) {
      return res.status(400).json({ error: 'FCM token es requerido' });
    }

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    await user.update({ pushToken: fcmToken });
    console.log(`[Auth] FCM token actualizado para usuario ${user.email}`);

    res.json({ message: 'Token FCM actualizado correctamente' });
  } catch (e) {
    console.error('[Auth] Error actualizando FCM token:', e);
    res.status(500).json({ error: e.message });
  }
};
