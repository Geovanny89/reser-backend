const { InventoryItem, InventoryUsage, Business, Appointment } = require('../models');
const { Op } = require('sequelize');

// Items (Insumos)
exports.getItems = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const items = await InventoryItem.findAll({
      where: { businessId, active: true },
      order: [['name', 'ASC']]
    });

    res.json(items);
  } catch (e) {
    console.error('[getItems] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.createItem = async (req, res) => {
  try {
    const { businessId, name, description, unit, currentStock, minStock, costPerUnit, supplier } = req.body;

    if (!businessId || !name || !unit) {
      return res.status(400).json({ error: 'businessId, name y unit son requeridos' });
    }

    // Verificar módulo habilitado
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const enabledModules = business.enabledModules || {};
    if (!enabledModules.inventory) {
      return res.status(403).json({ error: 'El módulo de inventario no está habilitado' });
    }

    const item = await InventoryItem.create({
      businessId,
      name,
      description,
      unit,
      currentStock: parseFloat(currentStock) || 0,
      minStock: parseFloat(minStock) || 0,
      costPerUnit: costPerUnit ? parseFloat(costPerUnit) : null,
      supplier
    });

    res.status(201).json(item);
  } catch (e) {
    console.error('[createItem] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.updateItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Insumo no encontrado' });

    const updateData = { ...req.body };
    if (updateData.currentStock !== undefined) updateData.currentStock = parseFloat(updateData.currentStock);
    if (updateData.minStock !== undefined) updateData.minStock = parseFloat(updateData.minStock);
    if (updateData.costPerUnit !== undefined) updateData.costPerUnit = updateData.costPerUnit ? parseFloat(updateData.costPerUnit) : null;

    await item.update(updateData);
    res.json(item);
  } catch (e) {
    console.error('[updateItem] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Insumo no encontrado' });

    await item.update({ active: false });
    res.json({ message: 'Insumo desactivado' });
  } catch (e) {
    console.error('[deleteItem] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

// Usages (Consumos)
exports.recordUsage = async (req, res) => {
  try {
    const { businessId, itemId, appointmentId, quantity, date, notes } = req.body;

    if (!businessId || !itemId || !quantity || !date) {
      return res.status(400).json({ error: 'businessId, itemId, quantity y date son requeridos' });
    }

    const item = await InventoryItem.findByPk(itemId);
    if (!item) return res.status(404).json({ error: 'Insumo no encontrado' });

    // Verificar stock suficiente
    const qty = parseFloat(quantity);
    if (item.currentStock < qty) {
      return res.status(400).json({ error: `Stock insuficiente. Disponible: ${item.currentStock} ${item.unit}` });
    }

    // Registrar uso
    const usage = await InventoryUsage.create({
      businessId,
      itemId,
      appointmentId: appointmentId || null,
      quantity: qty,
      date,
      notes,
      usedBy: req.user?.id
    });

    // Descontar del stock
    await item.update({ currentStock: item.currentStock - qty });

    res.status(201).json(usage);
  } catch (e) {
    console.error('[recordUsage] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.getUsages = async (req, res) => {
  try {
    const { businessId, itemId, startDate, endDate } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const where = { businessId };
    if (itemId) where.itemId = itemId;
    if (startDate && endDate) where.date = { [Op.between]: [startDate, endDate] };

    const usages = await InventoryUsage.findAll({
      where,
      include: [
        { model: InventoryItem, attributes: ['name', 'unit'] },
        { model: Appointment, attributes: ['clientName', 'startTime'] }
      ],
      order: [['date', 'DESC']]
    });

    res.json(usages);
  } catch (e) {
    console.error('[getUsages] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.getLowStock = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const items = await InventoryItem.findAll({
      where: { 
        businessId, 
        active: true,
        currentStock: { [Op.lte]: sequelize.col('minStock') }
      }
    });

    res.json(items);
  } catch (e) {
    console.error('[getLowStock] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
