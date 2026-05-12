const { CashRegisterShift, CashMovement, Employee, Appointment, Expense, Business, User } = require('../../models');

/**
 * Obtener movimientos de un turno
 */
async function getShiftMovements(req, res) {
  try {
    const { shiftId } = req.params;
    const { type, paymentMethod } = req.query;

    const whereClause = { shiftId };
    if (type) whereClause.type = type;
    if (paymentMethod) whereClause.paymentMethod = paymentMethod;

    const movements = await CashMovement.findAll({
      where: whereClause,
      include: [
        { model: Appointment, as: 'Appointment' },
        { model: Expense, as: 'Expense' },
        { model: CashMovement, as: 'Reversal' }
      ],
      order: [['createdAt', 'DESC']]
    });

    const shift = await CashRegisterShift.findByPk(shiftId, {
      include: [{ model: Employee, as: 'Employee' }]
    });

    if (!shift) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    const business = await Business.findByPk(shift.businessId);
    const includeTransfers = business?.includeTransfersInCashRegister !== false;

    let income = 0;
    let expenses = 0;
    let withdrawals = 0;
    let totalSupplies = 0;
    let totalFixedExpenses = 0;

    // Re-ejecutaré el cálculo completo para el shift
    const allMovements = await CashMovement.findAll({
      where: { shiftId },
      include: [{ model: CashMovement, as: 'ReversedMovement' }]
    });

    allMovements.forEach(m => {
      const amount = parseFloat(m.amount) || 0;
      if (m.isReversal) {
        const reversed = m.ReversedMovement;
        if (reversed?.type === 'income') income -= amount;
        else if (reversed?.type === 'expense') {
          if (reversed.category === 'supplies') totalSupplies -= amount;
          else if (reversed.category === 'fixed') totalFixedExpenses -= amount;
          else expenses -= amount;
        }
        else if (reversed?.type === 'withdrawal') withdrawals -= amount;
      } else {
        if (m.type === 'income') {
          if (!includeTransfers && m.paymentMethod === 'transfer') return;
          income += amount;
        } else if (m.type === 'expense') {
          if (m.category === 'supplies') totalSupplies += amount;
          else if (m.category === 'fixed') totalFixedExpenses += amount;
          else expenses += amount;
        } else if (m.type === 'withdrawal') withdrawals += amount;
      }
    });

    const expectedAmount = parseFloat(shift.openingAmount) + income - expenses - withdrawals - totalSupplies;

    res.json({ 
      shift: {
        ...shift.toJSON(),
        currentAmount: expectedAmount,
        totalIncome: income,
        totalExpenses: expenses,
        totalWithdrawals: withdrawals,
        totalSupplies: totalSupplies,
        totalFixedExpenses: totalFixedExpenses,
        movementsCount: allMovements.length
      },
      movements 
    });
  } catch (error) {
    console.error('Error obteniendo movimientos:', error);
    res.status(500).json({ error: 'Error al obtener movimientos' });
  }
}

/**
 * Crear movimiento de caja manual
 */
async function createMovement(req, res) {
  try {
    const { businessId, shiftId, type, amount, paymentMethod, description, notes, appointmentId, expenseId, category } = req.body;

    if (!businessId || !shiftId) {
      return res.status(400).json({ error: 'businessId y shiftId son requeridos' });
    }
    if (!type || !['income', 'expense', 'withdrawal'].includes(type)) {
      return res.status(400).json({ error: 'Tipo de movimiento inválido' });
    }
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'El monto debe ser un número mayor a 0' });
    }
    if (!description || String(description).trim().length < 2) {
      return res.status(400).json({ error: 'La descripción es obligatoria' });
    }

    const shift = await CashRegisterShift.findByPk(shiftId);
    if (!shift || shift.status !== 'open') {
      return res.status(400).json({ error: 'El turno no existe o no está activo' });
    }
    if (String(shift.businessId) !== String(businessId)) {
      return res.status(400).json({ error: 'El turno no pertenece al negocio indicado' });
    }

    const movement = await CashMovement.create({
      businessId,
      shiftId,
      type,
      amount: parsedAmount,
      paymentMethod: paymentMethod || 'cash',
      description: String(description).trim(),
      notes,
      appointmentId: appointmentId || null,
      expenseId: expenseId || null,
      category: category || 'general',
      createdBy: req.user?.id
    });

    const updatedShift = await CashRegisterShift.findByPk(shiftId, {
      include: [{ model: Employee, as: 'Employee' }]
    });

    const movements = await CashMovement.findAll({
      where: { shiftId }
    });

    const income = movements
      .filter(m => m.type === 'income')
      .reduce((sum, m) => sum + parseFloat(m.amount), 0);
    
    const expenses = movements
      .filter(m => m.type === 'expense')
      .reduce((sum, m) => sum + parseFloat(m.amount), 0);
    
    const withdrawals = movements
      .filter(m => m.type === 'withdrawal')
      .reduce((sum, m) => sum + parseFloat(m.amount), 0);

    const currentAmount = parseFloat(updatedShift.openingAmount) + income - (expenses - movements.filter(m => m.category === 'fixed').reduce((sum, m) => sum + parseFloat(m.amount), 0)) - withdrawals - movements.filter(m => m.category === 'supplies').reduce((sum, m) => sum + parseFloat(m.amount), 0);

    res.status(201).json({
      movement,
      shift: {
        ...updatedShift.toJSON(),
        currentAmount,
        totalIncome: income,
        totalExpenses: movements.filter(m => m.type === 'expense' && m.category !== 'supplies' && m.category !== 'fixed').reduce((sum, m) => sum + parseFloat(m.amount), 0),
        totalWithdrawals: withdrawals,
        totalSupplies: movements.filter(m => m.category === 'supplies').reduce((sum, m) => sum + parseFloat(m.amount), 0),
        totalFixedExpenses: movements.filter(m => m.category === 'fixed').reduce((sum, m) => sum + parseFloat(m.amount), 0),
        movementsCount: movements.length
      },
      movements
    });
  } catch (error) {
    console.error('Error creando movimiento:', error);
    res.status(500).json({ error: 'Error al crear movimiento de caja' });
  }
}

/**
 * Corregir movimiento de caja (crear reversa + nuevo movimiento)
 */
async function correctMovement(req, res) {
  try {
    const { movementId } = req.params;
    const { correctAmount, reason, type, paymentMethod, description } = req.body;

    const movement = await CashMovement.findByPk(movementId);
    if (!movement) return res.status(404).json({ error: 'Movimiento no encontrado' });

    if (movement.isReversal) {
      return res.status(400).json({ error: 'No se pueden corregir movimientos de reversa' });
    }

    const newAmount = parseFloat(correctAmount);
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      return res.status(400).json({ error: 'El monto debe ser un número mayor o igual a 0' });
    }

    const shift = await CashRegisterShift.findByPk(movement.shiftId);
    if (shift.status !== 'open') {
      return res.status(400).json({ error: 'No se pueden corregir movimientos de turnos cerrados' });
    }

    if (movement.appointmentId || movement.expenseId) {
      return res.status(400).json({ error: 'No se pueden corregir movimientos automáticos. Edite el origen si es necesario.' });
    }

    const oldAmount = parseFloat(movement.amount);
    const reversalType = movement.type === 'income' ? 'expense' : 'income';

    const reversal = await CashMovement.create({
      businessId: movement.businessId,
      shiftId: movement.shiftId,
      type: reversalType,
      amount: oldAmount,
      paymentMethod: movement.paymentMethod,
      description: `REVERSA: ${movement.description}`,
      notes: `Corrección automática. Motivo: ${reason || 'Error en registro'} | ID Original: ${movement.id}`,
      isReversal: true,
      reversesMovementId: movement.id,
      createdBy: req.user?.id
    });

    let corrected = null;
    if (newAmount > 0) {
      corrected = await CashMovement.create({
        businessId: movement.businessId,
        shiftId: movement.shiftId,
        type: type || movement.type,
        amount: newAmount,
        paymentMethod: paymentMethod || movement.paymentMethod,
        description: description || movement.description,
        notes: `Corrección. Anterior: ${movement.type} $${oldAmount.toLocaleString('es-CO')} | Motivo: ${reason || 'Corrección'}`,
        isReversal: false,
        reversesMovementId: null,
        createdBy: req.user?.id
      });
    }

    res.status(201).json({
      message: newAmount === 0 ? 'Movimiento anulado exitosamente' : 'Movimiento corregido exitosamente',
      reversal,
      corrected,
      oldAmount,
      newAmount
    });
  } catch (error) {
    console.error('Error corrigiendo movimiento:', error);
    res.status(500).json({ error: 'Error al corregir movimiento' });
  }
}

/**
 * Eliminar movimiento de caja
 */
async function deleteMovement(req, res) {
  try {
    return res.status(400).json({
      error: 'No se permite eliminar movimientos de caja. Usa "Corregir" para mantener trazabilidad.'
    });
  } catch (error) {
    console.error('Error eliminando movimiento:', error);
    res.status(500).json({ error: 'Error al eliminar movimiento' });
  }
}

module.exports = {
  getShiftMovements,
  createMovement,
  correctMovement,
  deleteMovement
};
