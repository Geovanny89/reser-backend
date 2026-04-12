const { Promotion, Service, Business } = require('../models');
const { Op } = require('sequelize');

exports.create = async (req, res) => {
  try {
    console.log('[Promotion] Creando promoción:', req.body);
    const { businessId, serviceId, name, description, discountType, discountValue, startDate, endDate, active, applyToAllServices } = req.body;
    
    // Validaciones básicas
    if (!businessId) throw new Error('El ID del negocio es requerido');
    if (!name) throw new Error('El nombre es requerido');
    if (!discountValue) throw new Error('El valor del descuento es requerido');
    if (!startDate || !endDate) throw new Error('Las fechas son requeridas');

    const promotion = await Promotion.create({
      businessId,
      serviceId: (applyToAllServices || !serviceId) ? null : serviceId,
      name,
      description,
      discountType,
      discountValue: parseFloat(discountValue),
      startDate,
      endDate,
      active: active !== false,
      applyToAllServices: applyToAllServices === true
    });
    
    console.log('[Promotion] Promoción creada:', promotion.id);
    res.status(201).json(promotion);
  } catch (e) {
    console.error('[Promotion] Error al crear:', e.message);
    res.status(400).json({ error: e.message });
  }
};

exports.getAllByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const promotions = await Promotion.findAll({
      where: { businessId },
      include: [{ model: Service, attributes: ['name'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(promotions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.getActiveByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;
    const now = new Date();
    const promotions = await Promotion.findAll({
      where: {
        businessId,
        active: true,
        startDate: { [Op.lte]: now },
        endDate: { [Op.gte]: now }
      },
      include: [{ model: Service, attributes: ['name'] }]
    });
    res.json(promotions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const promotion = await Promotion.findByPk(id);
    if (!promotion) return res.status(404).json({ error: 'Promoción no encontrada' });
    
    await promotion.update(req.body);
    res.json(promotion);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;
    const promotion = await Promotion.findByPk(id);
    if (!promotion) return res.status(404).json({ error: 'Promoción no encontrada' });
    
    await promotion.destroy();
    res.json({ message: 'Promoción eliminada correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
