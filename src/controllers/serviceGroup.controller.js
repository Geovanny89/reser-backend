const { ServiceGroup, Service, Business } = require('../models');
const { deleteFromCloudinary } = require('../config/cloudinary');
const { Op } = require('sequelize');

/**
 * Obtener todos los grupos de servicios de un negocio
 */
exports.getByBusiness = async (req, res) => {
  try {
    const businessId = req.query.businessId || req.params.businessId;
    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    const groups = await ServiceGroup.findAll({
      where: { businessId, active: true },
      order: [['order', 'ASC'], ['name', 'ASC']],
      include: [{
        model: Service,
        as: 'Services',
        where: { active: true },
        required: false,
        order: [['name', 'ASC']]
      }]
    });

    res.json(groups);
  } catch (e) {
    console.error('[ServiceGroup] Error al obtener grupos:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Crear un nuevo grupo de servicios
 */
exports.create = async (req, res) => {
  try {
    const { name, description, imageUrl, order, businessId } = req.body;
    const userId = req.user.id;

    // Determinar el businessId final
    let finalBusinessId = businessId;
    if (!finalBusinessId) {
      const biz = await Business.findOne({ where: { ownerId: userId, isBranch: false } });
      if (biz) {
        finalBusinessId = biz.id;
      } else {
        const { Employee } = require('../models');
        const emp = await Employee.findOne({ where: { userId, isManager: true } });
        if (emp) {
          finalBusinessId = emp.businessId;
        }
      }
    }

    if (!finalBusinessId) {
      return res.status(404).json({ error: 'No se pudo encontrar un negocio asociado a tu cuenta' });
    }

    const group = await ServiceGroup.create({
      businessId: finalBusinessId,
      name,
      description: description || null,
      imageUrl: imageUrl || null,
      order: order || 0,
      active: true
    });

    res.status(201).json(group);
  } catch (e) {
    console.error('[ServiceGroup] Error al crear grupo:', e);
    res.status(400).json({ error: e.message });
  }
};

/**
 * Actualizar un grupo de servicios
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, imageUrl, order } = req.body;

    const group = await ServiceGroup.findByPk(id);
    if (!group) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (order !== undefined) updateData.order = parseInt(order);

    // Manejar actualización de imagen
    if (imageUrl !== undefined && imageUrl !== group.imageUrl) {
      // Si hay una imagen anterior diferente, eliminarla de Cloudinary
      if (group.imageUrl && group.imageUrl.includes('cloudinary')) {
        await deleteFromCloudinary(group.imageUrl);
      }
      updateData.imageUrl = imageUrl;
    }

    await group.update(updateData);

    // Devolver el grupo actualizado con sus servicios
    const updatedGroup = await ServiceGroup.findByPk(id, {
      include: [{
        model: Service,
        as: 'Services',
        where: { active: true },
        required: false
      }]
    });

    res.json(updatedGroup);
  } catch (e) {
    console.error('[ServiceGroup] Error al actualizar grupo:', e);
    res.status(400).json({ error: e.message });
  }
};

/**
 * Eliminar un grupo de servicios (soft delete)
 * También elimina la imagen de Cloudinary si existe
 */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await ServiceGroup.findByPk(id);
    if (!group) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    // Eliminar imagen de Cloudinary si existe
    if (group.imageUrl && group.imageUrl.includes('cloudinary')) {
      await deleteFromCloudinary(group.imageUrl);
    }

    // Desasociar servicios del grupo (poner serviceGroupId a null)
    await Service.update(
      { serviceGroupId: null },
      { where: { serviceGroupId: id } }
    );

    // Soft delete del grupo
    await group.update({ active: false });

    res.json({ message: 'Grupo eliminado correctamente' });
  } catch (e) {
    console.error('[ServiceGroup] Error al eliminar grupo:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Asignar servicios a un grupo
 */
exports.assignServices = async (req, res) => {
  try {
    const { id } = req.params;
    const { serviceIds } = req.body;

    if (!Array.isArray(serviceIds)) {
      return res.status(400).json({ error: 'serviceIds debe ser un array' });
    }

    const group = await ServiceGroup.findByPk(id);
    if (!group) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    // Actualizar los servicios para asignarlos al grupo
    await Service.update(
      { serviceGroupId: id },
      { 
        where: { 
          id: { [Op.in]: serviceIds },
          businessId: group.businessId
        } 
      }
    );

    // Devolver el grupo actualizado
    const updatedGroup = await ServiceGroup.findByPk(id, {
      include: [{
        model: Service,
        as: 'Services',
        where: { active: true },
        required: false
      }]
    });

    res.json(updatedGroup);
  } catch (e) {
    console.error('[ServiceGroup] Error al asignar servicios:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Remover servicios de un grupo
 */
exports.removeServices = async (req, res) => {
  try {
    const { id } = req.params;
    const { serviceIds } = req.body;

    if (!Array.isArray(serviceIds)) {
      return res.status(400).json({ error: 'serviceIds debe ser un array' });
    }

    const group = await ServiceGroup.findByPk(id);
    if (!group) {
      return res.status(404).json({ error: 'Grupo no encontrado' });
    }

    // Quitar servicios del grupo (poner serviceGroupId a null)
    await Service.update(
      { serviceGroupId: null },
      { 
        where: { 
          id: { [Op.in]: serviceIds },
          serviceGroupId: id
        } 
      }
    );

    res.json({ message: 'Servicios removidos del grupo correctamente' });
  } catch (e) {
    console.error('[ServiceGroup] Error al remover servicios:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Reordenar grupos
 */
exports.reorder = async (req, res) => {
  try {
    const { businessId } = req.query;
    const { orders } = req.body; // Array de { id, order }

    if (!Array.isArray(orders)) {
      return res.status(400).json({ error: 'orders debe ser un array de { id, order }' });
    }

    // Actualizar el orden de cada grupo
    for (const { id, order } of orders) {
      await ServiceGroup.update(
        { order: parseInt(order) },
        { where: { id, businessId } }
      );
    }

    // Devolver grupos actualizados
    const groups = await ServiceGroup.findAll({
      where: { businessId, active: true },
      order: [['order', 'ASC'], ['name', 'ASC']]
    });

    res.json(groups);
  } catch (e) {
    console.error('[ServiceGroup] Error al reordenar grupos:', e);
    res.status(500).json({ error: e.message });
  }
};
