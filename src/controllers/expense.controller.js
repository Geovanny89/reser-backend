const { Expense, Business, CashRegisterShift, CashMovement } = require('../models');
const { Op } = require('sequelize');

exports.getByBusiness = async (req, res) => {
  try {
    const { businessId } = req.query;
    if (!businessId) return res.status(400).json({ error: 'businessId es requerido' });

    const { startDate, endDate, category } = req.query;
    const where = { businessId, status: 'active' };

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

    // Registrar movimiento en caja si es pago en efectivo Y la fecha es hoy
    const today = new Date().toISOString().split('T')[0];
    const isToday = date === today;
    
    if ((paymentMethod === 'cash' || !paymentMethod) && isToday) {
      try {
        const activeShift = await CashRegisterShift.findOne({
          where: {
            businessId,
            status: 'open'
          }
        });

        if (activeShift) {
          // Mapear categoría del gasto a categoría de movimiento de caja
          let movementCategory = 'general';
          const catLower = String(category).toLowerCase();
          
          if (catLower.includes('arriendo') || catLower.includes('servicio') || catLower.includes('fijo') || catLower.includes('alquiler')) {
            movementCategory = 'fixed';
          } else if (catLower.includes('insumo') || catLower.includes('material') || catLower.includes('suministro')) {
            movementCategory = 'supplies';
          }

          await CashMovement.create({
            businessId,
            shiftId: activeShift.id,
            expenseId: expense.id,
            type: 'expense',
            amount: parseFloat(amount),
            paymentMethod: 'cash',
            category: movementCategory,
            description: `Gasto: ${description} (${category})`,
            notes,
            createdBy: req.user?.id
          });
          console.log(`[Cash Register] Movimiento de gasto (${movementCategory}) registrado: $${amount}`);
        } else {
          console.log(`[Cash Register] No hay turno activo para registrar gasto en caja`);
        }
      } catch (cashError) {
        console.error('[Cash Register] Error registrando movimiento de gasto:', cashError.message);
        // No interrumpir el flujo principal si falla el registro en caja
      }
    } else if ((paymentMethod === 'cash' || !paymentMethod) && !isToday) {
      console.log(`[Cash Register] Gasto de fecha ${date} no registrado en caja actual (turno de hoy)`);
    }

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

    // En "producción real", si el gasto ya impactó caja (cash_movements),
    // NO es sano borrarlo: se debe anular con trazabilidad.
    const movement = await CashMovement.findOne({ where: { expenseId: id } });
    if (movement) {
      return res.status(400).json({
        error: 'Este gasto ya impactó la caja. No se puede eliminar; anúlalo para mantener trazabilidad.'
      });
    }

    await expense.destroy();
    res.json({ message: 'Gasto eliminado' });
  } catch (e) {
    console.error('[remove] Error:', e);
    res.status(500).json({ error: e.message });
  }
};

/**
 * Anular gasto con trazabilidad.
 * - Marca el gasto como void
 * - Si existe movimiento en caja y el turno está abierto, crea un movimiento de reversa
 */
exports.voidExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const expense = await Expense.findByPk(id);
    if (!expense) return res.status(404).json({ error: 'Gasto no encontrado' });
    if (expense.status === 'void') return res.status(400).json({ error: 'El gasto ya está anulado' });

    // Buscar movimiento de caja asociado (si lo hubo)
    const movement = await CashMovement.findOne({ where: { expenseId: id } });
    if (movement) {
      const shift = await CashRegisterShift.findByPk(movement.shiftId);
      if (!shift || shift.status !== 'open') {
        return res.status(400).json({
          error: 'No se puede anular un gasto que ya quedó en un turno de caja cerrado.'
        });
      }

      // Reversa: el gasto fue type=expense (-), así que la reversa debe ser income (+)
      await CashMovement.create({
        businessId: movement.businessId,
        shiftId: movement.shiftId,
        expenseId: id,
        type: 'income',
        amount: parseFloat(movement.amount),
        paymentMethod: movement.paymentMethod,
        description: `REVERSA GASTO: ${expense.description} (${expense.category})`,
        notes: `Anulación de gasto. Motivo: ${reason || 'Anulación'} | Movimiento original: ${movement.id}`,
        isReversal: true,
        reversesMovementId: movement.id,
        createdBy: req.user?.id,
      });
    }

    await expense.update({
      status: 'void',
      voidedAt: new Date(),
      voidReason: reason || 'Anulación',
    });

    res.json({ message: 'Gasto anulado', expense });
  } catch (e) {
    console.error('[voidExpense] Error:', e);
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
