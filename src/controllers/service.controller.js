const { Service, Business } = require('../models');

exports.getByBusiness = async (req, res) => {
  try {
    const businessId = req.params.businessId || req.query.businessId;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });
    const services = await Service.findAll({
      where: { businessId, active: true }
    });
    res.json(services);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, price, durationMin } = req.body;
    const adminId = req.user.id; // Obtener del usuario autenticado

    // Obtener el negocio del admin
    const business = await Business.findOne({ where: { ownerId: adminId } });
    if (!business) {
      return res.status(404).json({ error: 'No tienes un negocio asociado' });
    }

    const service = await Service.create({
      businessId: business.id,
      name,
      description,
      price,
      durationMin
    });
    res.status(201).json(service);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const service = await Service.findByPk(req.params.id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    await service.update(req.body);
    res.json(service);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const service = await Service.findByPk(req.params.id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });
    await service.update({ active: false });
    res.json({ message: 'Servicio desactivado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
