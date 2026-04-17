const { Expense, Business } = require('../models');
const { Op } = require('sequelize');

exports.getByBusiness = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const { startDate, endDate, category } = req.query;
    const where = { businessId };

    if (startDate && endDate) {
      where.date = { [Op.between]: [startDate, endDate] };
    }
    if (category) {
      where.category = category;
    }

    const expenses = await Expense.findAll({
      where,
      order: [['date', 'DESC'], ['createdAt', 'DESC']]
    });

    // Calcular total
    const total = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount || 0), 0);

    res.json({ expenses, total: parseFloat(total.toFixed(2)) });
  } catch (e) {
    console.error('[getByBusiness] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { businessId, category, description, amount, date, paymentMethod, notes } = req.body;

    if (!businessId || !category || !description || !amount || !date) {
      return res.status(400).json({ error: 'businessId, category, description, amount y date son requeridos' });
    }

    // Verificar que el negocio tiene el módulo habilitado
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const enabledModules = business.enabledModules || {};
    if (!enabledModules.expenses) {
      return res.status(403).json({ error: 'El módulo de gastos no está habilitado para este negocio' });
    }

    const expense = await Expense.create({
      businessId,
      category,
      description,
      amount: parseFloat(amount),
      date,
      paymentMethod: paymentMethod || 'cash',
      notes,
      createdBy: req.user?.id
    });

    res.status(201).json(expense);
  } catch (e) {
    console.error('[create] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findByPk(id);
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });

    const updateData = { ...req.body };
    if (updateData.amount) updateData.amount = parseFloat(updateData.amount);

    await expense.update(updateData);
    res.json(expense);
  } catch (e) {
    console.error('[update] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await Expense.findByPk(id);
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });

    await expense.destroy();
    res.json({ message: 'Gasto eliminado' });
  } catch (e) {
    console.error('[remove] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { businessId } = req.query;
    const { year, month } = req.query;
    
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    let where = { businessId };
    
    if (year && month) {
      const startDate = `${year}-${month.padStart(2, '0')}-01`;
      const endDate = `${year}-${month.padStart(2, '0')}-31`;
      where.date = { [Op.between]: [startDate, endDate] };
    } else if (year) {
      where.date = { [Op.between]: [`${year}-01-01`, `${year}-12-31`] };
    }

    const expenses = await Expense.findAll({ where });

    // Agrupar por categoría
    const byCategory = {};
    let total = 0;
    
    expenses.forEach(exp => {
      const cat = exp.category;
      const amt = parseFloat(exp.amount || 0);
      byCategory[cat] = (byCategory[cat] || 0) + amt;
      total += amt;
    });

    res.json({
      total: parseFloat(total.toFixed(2)),
      byCategory,
      count: expenses.length
    });
  } catch (e) {
    console.error('[getSummary] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
