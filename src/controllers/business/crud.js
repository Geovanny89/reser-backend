/**
 * Controladores CRUD para negocios
 */
const { Business, Service, Employee, User, Appointment, AppointmentNote, Schedule, InventoryItem, InventoryUsage, WhatsAppSession } = require('../../models');
const { deleteFromCloudinary } = require('../../config/cloudinary');
const { ALLOWED_UPDATE_FIELDS } = require('./constants');
const { buildBusinessInclude } = require('./utils');
const cacheService = require('../../services/cacheService');
const { logActivity } = require('../../utils/activityLogger');


// POST /businesses (superadmin)
exports.create = async (req, res) => {
  try {
    const { name, type, ownerId, parentBusinessId } = req.body;
    
    let isBranch = false;
    let branchStatus = 'none';
    let status = 'active';

    if (parentBusinessId) {
      isBranch = true;
      branchStatus = 'pending_approval';
      status = 'blocked'; // Bloqueada hasta que el superadmin la apruebe
    }

    const biz = await Business.create({
      ...req.body,
      isBranch,
      branchStatus,
      status,
      referralDate: req.body.referredByCode ? new Date() : null
    });

    res.status(201).json(biz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// PUT /businesses/:id (superadmin o admin)
exports.update = async (req, res) => {
  try {
    const biz = await Business.findByPk(req.params.id);
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    // Conversión explícita de campos booleanos
    const updates = { ...req.body };
    if (updates.isTechnicalServices !== undefined) {
      updates.isTechnicalServices = updates.isTechnicalServices === true || updates.isTechnicalServices === 'true';
    }
    if (updates.hasFieldTechnicians !== undefined) {
      updates.hasFieldTechnicians = updates.hasFieldTechnicians === true || updates.hasFieldTechnicians === 'true';
    }
    
    await biz.update(updates);
    
    // Registrar actividad
    logActivity({ user: req.user }, {
      action: 'UPDATE_BUSINESS',
      entityType: 'Business',
      entityId: biz.id,
      businessId: biz.id,
      description: `Configuración de negocio actualizada: ${biz.name}`,
      newValues: updates
    });

    
    // Invalidar caché del negocio público
    if (biz.slug) {
      cacheService.delete(`business_public_${biz.slug}`);
    }
    
    res.json(biz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// PUT /businesses/my/business
exports.updateMyBusiness = async (req, res) => {
  try {
    const { businessId } = req.query;
    let biz = null;

    if (businessId) {
      biz = await Business.findByPk(businessId);
      if (biz) {
        const isOwner = biz.ownerId === req.user.id;
        const emp = await Employee.findOne({ where: { userId: req.user.id, businessId: biz.id, isManager: true } });
        const isManager = !!emp || req.user.role === 'admin_suc';
        if (!isOwner && !isManager) return res.status(403).json({ error: 'Sin permisos' });
      }
    }

    if (!biz) {
      biz = await Business.findOne({ 
        where: { ownerId: req.user.id },
        order: [['isBranch', 'ASC']] // Primero negocios principales
      });

      if (!biz && req.user.role === 'admin_suc') {
        const emp = await Employee.findOne({ where: { userId: req.user.id, isManager: true } });
        if (emp) biz = await Business.findByPk(emp.businessId);
      }
    }

    if (!biz) return res.status(404).json({ error: 'No tienes un negocio registrado o asignado' });
    
    const updates = {};
    ALLOWED_UPDATE_FIELDS.forEach(k => { 
      if (req.body[k] !== undefined) updates[k] = req.body[k]; 
    });
    
    // Conversión explícita de campos booleanos para asegurar valores correctos
    if (updates.isTechnicalServices !== undefined) {
      updates.isTechnicalServices = updates.isTechnicalServices === true || updates.isTechnicalServices === 'true';
    }
    if (updates.hasFieldTechnicians !== undefined) {
      updates.hasFieldTechnicians = updates.hasFieldTechnicians === true || updates.hasFieldTechnicians === 'true';
    }
    
    // Eliminar de Cloudinary si cambian imágenes
    if (updates.logoUrl && biz.logoUrl && updates.logoUrl !== biz.logoUrl) {
      await deleteFromCloudinary(biz.logoUrl);
    }
    if (updates.bannerUrl && biz.bannerUrl && updates.bannerUrl !== biz.bannerUrl) {
      await deleteFromCloudinary(biz.bannerUrl);
    }

    await biz.update(updates);
    
    // Invalidar caché del negocio público
    if (biz.slug) {
      cacheService.delete(`business_public_${biz.slug}`);
    }
    
    // Recargar el negocio desde la base de datos para obtener los valores actualizados
    const updatedBiz = await Business.findByPk(biz.id);
    
    res.json(updatedBiz);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

// DELETE /businesses/:id
exports.remove = async (req, res) => {
  try {
    const biz = await Business.findByPk(req.params.id);
    if (!biz) return res.status(404).json({ error: 'Negocio no encontrado' });

    // Eliminar en orden por dependencias
    // Primero obtener IDs de citas para eliminar sus notas
    const appointments = await Appointment.findAll({
      where: { businessId: biz.id },
      attributes: ['id']
    });
    const appointmentIds = appointments.map(a => a.id);
    if (appointmentIds.length > 0) {
      await AppointmentNote.destroy({ where: { appointmentId: appointmentIds } });
    }
    await Appointment.destroy({ where: { businessId: biz.id } });
    await Schedule.destroy({ where: { businessId: biz.id } });
    await Employee.destroy({ where: { businessId: biz.id } });
    await InventoryUsage.destroy({ where: { businessId: biz.id } });
    await InventoryItem.destroy({ where: { businessId: biz.id } });
    await Service.destroy({ where: { businessId: biz.id } });
    await WhatsAppSession.destroy({ where: { businessId: biz.id } });

    // Eliminar imágenes de Cloudinary
    if (biz.logoUrl) await deleteFromCloudinary(biz.logoUrl);
    if (biz.bannerUrl) await deleteFromCloudinary(biz.bannerUrl);
    
    let gallery = [];
    try { gallery = JSON.parse(biz.gallery || '[]'); } catch { gallery = []; }
    for (const url of gallery) {
      await deleteFromCloudinary(url);
    }

    const bizInfo = { name: biz.name, slug: biz.slug, ownerId: biz.ownerId };
    await biz.destroy();
    
    // Registrar actividad
    logActivity({ user: req.user }, {
      action: 'DELETE_BUSINESS',
      entityType: 'Business',
      entityId: biz.id,
      businessId: biz.id,
      description: `Negocio eliminado permanentemente: ${bizInfo.name} (${bizInfo.slug})`,
      oldValues: bizInfo
    });

    res.json({ message: 'Negocio y todos sus datos eliminados correctamente' });
  } catch (e) {
    console.error('Error eliminando negocio:', e);
    res.status(400).json({ error: e.message });
  }
};

// PATCH /businesses/:id/toggle-status
exports.toggleStatus = async (req, res) => {
  try {
    const b = await Business.findByPk(req.params.id);
    if (!b) return res.status(404).json({ error: 'Negocio no encontrado' });
    const newStatus = b.status === 'active' ? 'blocked' : 'active';
    await b.update({ status: newStatus });

    // Bloquear/desbloquear al dueño
    await User.update({ status: newStatus }, { where: { id: b.ownerId } });

    res.json(b);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// PUT /businesses/:id/mission-vision
exports.updateMissionVision = async (req, res) => {
  try {
    const { id } = req.params;
    const { mission, vision, showMissionVision } = req.body;
    
    const business = await Business.findByPk(id);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const isOwner = business.ownerId === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_suc' || req.user.role === 'superadmin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'No autorizado' });
    
    await business.update({
      mission: mission !== undefined ? mission : business.mission,
      vision: vision !== undefined ? vision : business.vision,
      showMissionVision: showMissionVision !== undefined ? showMissionVision : business.showMissionVision
    });
    
    res.json({ 
      message: 'Misión y visión actualizadas correctamente', 
      business 
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
