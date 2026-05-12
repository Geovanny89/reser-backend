const { CashRegisterShift, CashMovement, Employee, Business } = require('../../models');

/**
 * Obtener turno de caja activo del negocio
 */
async function getActiveShift(req, res) {
  try {
    const { businessId } = req.query;

    const business = await Business.findByPk(businessId);
    const includeTransfers = business?.includeTransfersInCashRegister !== false;

    const activeShift = await CashRegisterShift.findOne({
      where: {
        businessId,
        status: 'open'
      },
      include: [
        { model: Employee, as: 'Employee' }
      ],
      order: [['openedAt', 'DESC']]
    });

    if (!activeShift) {
      return res.json({ activeShift: null, message: 'No hay turno activo' });
    }

    const movements = await CashMovement.findAll({
      where: { shiftId: activeShift.id },
      include: [{ model: CashMovement, as: 'ReversedMovement' }]
    });

    let income = 0;
    let expenses = 0;
    let withdrawals = 0;
    let totalSupplies = 0;
    let totalFixedExpenses = 0;

    movements.forEach(m => {
      const amount = parseFloat(m.amount) || 0;
      
      if (m.isReversal) {
        const reversed = m.ReversedMovement;
        if (!reversed) return;

        if (reversed.type === 'income') {
          income -= amount;
        } else if (reversed.type === 'expense') {
          if (reversed.category === 'supplies') totalSupplies -= amount;
          else if (reversed.category === 'fixed') totalFixedExpenses -= amount;
          else expenses -= amount;
        } else if (reversed.type === 'withdrawal') {
          withdrawals -= amount;
        }
      } else {
        if (m.type === 'income') {
          if (!includeTransfers && m.paymentMethod === 'transfer') return;
          income += amount;
        } else if (m.type === 'expense') {
          if (m.category === 'supplies') totalSupplies += amount;
          else if (m.category === 'fixed') totalFixedExpenses += amount;
          else expenses += amount;
        } else if (m.type === 'withdrawal') {
          withdrawals += amount;
        }
      }
    });

    const currentAmount = parseFloat(activeShift.openingAmount) + income - expenses - withdrawals - totalSupplies;

    res.json({
      activeShift: {
        ...activeShift.toJSON(),
        currentAmount,
        totalIncome: income,
        totalExpenses: expenses,
        totalWithdrawals: withdrawals,
        totalSupplies: totalSupplies,
        totalFixedExpenses: totalFixedExpenses,
        movementsCount: movements.length
      },
      movements
    });
  } catch (error) {
    console.error('Error obteniendo turno activo:', error);
    res.status(500).json({ error: 'Error al obtener turno activo' });
  }
}

/**
 * Abrir nuevo turno de caja
 */
async function openShift(req, res) {
  try {
    const { businessId, employeeId, openingAmount, notes } = req.body;
    
    const existingActive = await CashRegisterShift.findOne({
      where: {
        businessId,
        status: 'open'
      }
    });

    if (existingActive) {
      return res.status(400).json({ error: 'Ya existe un turno activo. Ciérrelo antes de abrir uno nuevo.' });
    }

    // VALIDACIÓN: Asegurar que el employeeId sea un ID de empleado válido
    // Si no existe, pero es el ID del usuario actual, intentamos buscar su registro de empleado
    let finalEmployeeId = employeeId;
    if (employeeId) {
      const exists = await Employee.findByPk(employeeId);
      if (!exists) {
        // Buscar si es el userId y tiene un registro de empleado
        const empByUser = await Employee.findOne({ where: { userId: employeeId, businessId } });
        if (empByUser) {
          finalEmployeeId = empByUser.id;
        } else {
          // Si no es un empleado válido, lo dejamos como null para evitar el error de llave foránea
          // El campo createdBy seguirá registrando quién realizó la acción
          finalEmployeeId = null;
        }
      }
    }

    const shift = await CashRegisterShift.create({
      businessId,
      employeeId: finalEmployeeId,
      openingAmount: openingAmount || 0,
      openedAt: new Date(),
      status: 'open',
      notes,
      createdBy: req.user?.id
    });

    res.status(201).json(shift);
  } catch (error) {
    console.error('Error abriendo turno:', error);
    res.status(500).json({ error: 'Error al abrir turno de caja' });
  }
}

/**
 * Cerrar turno de caja (corte de caja)
 */
async function closeShift(req, res) {
  try {
    const { shiftId, closingAmount, notes } = req.body;
    
    const shift = await CashRegisterShift.findByPk(shiftId, {
      include: [{ model: Employee, as: 'Employee' }]
    });

    if (!shift) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    if (shift.status !== 'open') {
      return res.status(400).json({ error: 'El turno ya está cerrado' });
    }

    const movements = await CashMovement.findAll({
      where: { shiftId },
      include: [{ model: CashMovement, as: 'ReversedMovement' }]
    });

    const business = await Business.findByPk(shift.businessId);
    const includeTransfers = business?.includeTransfersInCashRegister !== false;

    let income = 0;
    let expenses = 0;
    let withdrawals = 0;
    let totalSupplies = 0;
    let totalFixedExpenses = 0;

    movements.forEach(m => {
      const amount = parseFloat(m.amount);
      
      if (m.isReversal) {
        if (m.ReversedMovement?.type === 'income') {
          income -= amount;
        } else if (m.ReversedMovement?.type === 'expense') {
          if (m.ReversedMovement.category === 'supplies') totalSupplies -= amount;
          else if (m.ReversedMovement.category === 'fixed') totalFixedExpenses -= amount;
          else expenses -= amount;
        } else if (m.ReversedMovement?.type === 'withdrawal') withdrawals -= amount;
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
    const difference = parseFloat(closingAmount) - expectedAmount;

    await shift.update({
      closedAt: new Date(),
      closingAmount,
      expectedAmount,
      difference,
      status: 'closed',
      notes: notes || shift.notes
    });

    res.json({
      ...shift.toJSON(),
      currentAmount: parseFloat(shift.openingAmount) + income - expenses - withdrawals - totalSupplies,
      totalIncome: income,
      totalExpenses: expenses,
      totalWithdrawals: withdrawals,
      totalSupplies: totalSupplies,
      totalFixedExpenses: totalFixedExpenses,
      movementsCount: movements.length
    });
  } catch (error) {
    console.error('Error cerrando turno:', error);
    res.status(500).json({ error: 'Error al cerrar turno de caja' });
  }
}

/**
 * Obtener historial de turnos
 */
async function getShiftHistory(req, res) {
  try {
    const { businessId, startDate, endDate, employeeId } = req.query;

    const whereClause = { businessId };
    if (startDate && endDate) {
      whereClause.openedAt = {
        [require('sequelize').Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }
    if (employeeId) {
      whereClause.employeeId = employeeId;
    }

    const shifts = await CashRegisterShift.findAll({
      where: whereClause,
      include: [
        { model: Employee, as: 'Employee' }
      ],
      order: [['openedAt', 'DESC']]
    });

    const shiftsWithSummary = await Promise.all(
      shifts.map(async (shift) => {
        const movements = await CashMovement.findAll({
          where: { shiftId: shift.id },
          include: [{ model: CashMovement, as: 'ReversedMovement' }]
        });

        let income = 0;
        let expenses = 0;
        let withdrawals = 0;
        let totalSupplies = 0;
        let totalFixedExpenses = 0;

        movements.forEach(m => {
          const amount = parseFloat(m.amount);
          
          if (m.isReversal) {
            if (m.ReversedMovement?.type === 'income') {
              income -= amount;
            } else if (m.ReversedMovement?.type === 'expense') {
              if (m.ReversedMovement.category === 'supplies') totalSupplies -= amount;
              else if (m.ReversedMovement.category === 'fixed') totalFixedExpenses -= amount;
              else expenses -= amount;
            } else if (m.ReversedMovement?.type === 'withdrawal') withdrawals -= amount;
          } else {
            if (m.type === 'income') income += amount;
            else if (m.type === 'expense') {
              if (m.category === 'supplies') totalSupplies += amount;
              else if (m.category === 'fixed') totalFixedExpenses += amount;
              else expenses += amount;
            } else if (m.type === 'withdrawal') withdrawals += amount;
          }
        });

        return {
          ...shift.toJSON(),
          totalIncome: income,
          totalExpenses: expenses,
          totalWithdrawals: withdrawals,
          totalSupplies: totalSupplies,
          totalFixedExpenses: totalFixedExpenses,
          movementsCount: movements.length
        };
      })
    );

    res.json({ shifts: shiftsWithSummary });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({ error: 'Error al obtener historial de turnos' });
  }
}

module.exports = {
  getActiveShift,
  openShift,
  closeShift,
  getShiftHistory
};
