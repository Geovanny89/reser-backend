/**
 * CRUD básico de empleados - Versión Original
 */

const { Employee, User, Appointment, Service, Business } = require('../../models');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const { deleteFromCloudinary } = require('../../config/cloudinary');
const { checkUserLimit } = require('./utils');
const cacheService = require('../../services/cacheService');

/**
 * Obtiene empleados por negocio con estadísticas
 */
async function getByBusiness(req, res) {
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
}

/**
 * Crea un nuevo empleado
 */
async function create(req, res) {
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
    }, {
      validate: false
    });

    // Invalidar caché del negocio público
    const business = await Business.findByPk(businessId);
    if (business && business.slug) {
      cacheService.invalidateBusinessPublic(business.slug);
    }

    res.status(201).json({
      ...emp.toJSON(),
      tempPassword // Devolver para mostrar al admin si se creó
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * Invita a un empleado (crea usuario + empleado)
 */
async function invite(req, res) {
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

    // Invalidar caché del negocio público
    const business = await Business.findByPk(finalBusinessId);
    if (business && business.slug) {
      cacheService.invalidateBusinessPublic(business.slug);
    }

    res.status(201).json({
      employee,
      user: { id: user.id, name: user.name, email: user.email },
      tempPassword // Enviar contraseña temporal (en producción, enviar por email)
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * Actualiza un empleado
 */
async function update(req, res) {
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

    // Invalidar caché del negocio público
    const business = await Business.findByPk(emp.businessId);
    if (business && business.slug) {
      cacheService.invalidateBusinessPublic(business.slug);
    }

    // Devolver empleado actualizado con datos del usuario
    const updatedEmp = await Employee.findByPk(req.params.id, {
      include: [{ model: User, attributes: ['id', 'name', 'email'] }]
    });

    res.json(updatedEmp);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * Elimina (desactiva) un empleado
 */
async function remove(req, res) {
  try {
    const emp = await Employee.findByPk(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });
    await emp.update({ active: false });

    // Invalidar caché del negocio público
    const business = await Business.findByPk(emp.businessId);
    if (business && business.slug) {
      cacheService.invalidateBusinessPublic(business.slug);
    }

    res.json({ message: 'Empleado desactivado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  getByBusiness,
  create,
  invite,
  update,
  remove
};
