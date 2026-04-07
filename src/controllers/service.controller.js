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
    const { name, description, price, durationMin, isTechnicalService, priceOptional, hasEmployeeCommission } = req.body;
    const adminId = req.user.id;

    const business = await Business.findOne({ where: { ownerId: adminId } });
    if (!business) {
      return res.status(404).json({ error: 'No tienes un negocio asociado' });
    }

    // Convertir precio vacío a null
    const parsedPrice = price === '' || price === undefined ? null : parseFloat(price);

    const service = await Service.create({
      businessId: business.id,
      name,
      description,
      price: parsedPrice,
      durationMin,
      isTechnicalService: isTechnicalService || false,
      priceOptional: priceOptional || false,
      hasEmployeeCommission: hasEmployeeCommission !== false // default true
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
    
    const updateData = { ...req.body };
    
    // Convertir precio vacío a null
    if (updateData.price === '' || updateData.price === undefined) {
      updateData.price = null;
    } else if (updateData.price !== null) {
      updateData.price = parseFloat(updateData.price);
    }
    
    // Asegurar booleanos
    if (updateData.isTechnicalService !== undefined) {
      updateData.isTechnicalService = !!updateData.isTechnicalService;
    }
    if (updateData.priceOptional !== undefined) {
      updateData.priceOptional = !!updateData.priceOptional;
    }
    if (updateData.hasEmployeeCommission !== undefined) {
      updateData.hasEmployeeCommission = updateData.hasEmployeeCommission !== false;
    }
    
    await service.update(updateData);
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
