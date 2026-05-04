const { Appointment, Expense, InventoryUsage, InventoryItem, Deposit, Business, CashRegisterShift, CashMovement } = require('../models');
const { Op } = require('sequelize');

exports.getFinancialReport = async (req, res) => {
  try {
    const { businessId, year, month, startDate: queryStartDate, endDate: queryEndDate, employeeId } = req.query;
    console.log('FINANCIAL_REPORT_QUERY:', { businessId, queryStartDate, queryEndDate, employeeId });
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    // Verificar que el negocio tiene los módulos habilitados
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const enabledModules = business.enabledModules || {};

    // Calcular fechas del período (Colombia Time -05:00)
    let startDate, endDate, periodInfo;
    
    if (queryStartDate && queryEndDate) {
      startDate = new Date(`${queryStartDate}T00:00:00-05:00`);
      endDate = new Date(`${queryEndDate}T23:59:59-05:00`);
      periodInfo = { startDate: queryStartDate, endDate: queryEndDate, type: 'custom' };
    } else if (year && month) {
      const startStr = `${year}-${month.padStart(2, '0')}-01`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      const endStr = `${year}-${month.padStart(2, '0')}-${lastDay}`;
      
      startDate = new Date(`${startStr}T00:00:00-05:00`);
      endDate = new Date(`${endStr}T23:59:59-05:00`);
      periodInfo = { year, month, startDate: startStr, endDate: endStr, type: 'month' };
    } else {
      return res.status(400).json({ error: 'Debe proporcionar year+month o startDate+endDate' });
    }

    // === INGRESOS: Basados en movimientos de caja (dinero real) ===
    const movementsWhere = {
      businessId,
      createdAt: { [Op.between]: [startDate, endDate] }
    };

    const movements = await CashMovement.findAll({
      where: movementsWhere,
      include: [
        { model: CashMovement, as: 'ReversedMovement' },
        { 
          model: Appointment, 
          attributes: ['id', 'employeeId', 'finalPrice', 'basePrice', 'discountApplied'],
          include: [{ model: require('../models').Employee, attributes: ['id', 'commissionPct'] }]
        }
      ]
    });

    let totalIncome = 0;
    let transferIncome = 0;
    let cashIncome = 0;
    let totalDiscounts = 0;

    movements.forEach(m => {
      // Solo contar ingresos (y restar sus reversas)
      let amount = parseFloat(m.amount || 0);
      let isIncome = false;
      let paymentMethod = m.paymentMethod;

      if (m.type === 'income' && !m.isReversal) {
        isIncome = true;
      } else if (m.isReversal && m.ReversedMovement?.type === 'income') {
        isIncome = true;
        amount = -amount; // Restar reversa
        paymentMethod = m.ReversedMovement.paymentMethod;
      }

      if (isIncome) {
        // Si hay filtro de empleado, verificar que el movimiento esté asociado a una cita de ese empleado
        if (employeeId && employeeId !== 'all' && employeeId !== '') {
          if (!m.Appointment || String(m.Appointment.employeeId) !== employeeId) {
            return; // Omitir si no coincide el empleado
          }
        }

        totalIncome += amount;
        if (paymentMethod === 'transfer') {
          transferIncome += amount;
        } else {
          cashIncome += amount;
        }

        if (m.Appointment?.discountApplied) {
          totalDiscounts += parseFloat(m.Appointment.discountApplied);
        }
      }
    });

    // === COMISIONES: Siguen basándose en citas completadas ===
    const appointmentsWhere = {
      businessId,
      status: 'done',
      startTime: { [Op.between]: [startDate, endDate] }
    };

    if (employeeId && employeeId !== 'all' && employeeId !== '') {
      appointmentsWhere.employeeId = employeeId;
    }

    const appointments = await Appointment.findAll({
      where: appointmentsWhere,
      include: [
        {
          model: require('../models').Employee,
          attributes: ['id', 'commissionPct']
        }
      ]
    });

    const totalCommissions = appointments.reduce((sum, apt) => {
      const priceForCommission = (apt.finalPrice !== null && apt.finalPrice !== undefined) ? apt.finalPrice : (apt.basePrice || 0);
      const commPct = parseFloat(apt.Employee?.commissionPct || 0);
      const earned = (apt.employeeEarns !== null && apt.employeeEarns !== undefined)
        ? parseFloat(apt.employeeEarns)
        : (priceForCommission * commPct) / 100;
      return sum + (isNaN(earned) ? 0 : earned);
    }, 0);

    const appointmentCount = appointments.length;

    // === GASTOS: Solo si el módulo está habilitado ===
    let expenses = { total: 0, byCategory: {}, list: [] };
    if (enabledModules.expenses) {
      const expenseData = await Expense.findAll({
        where: {
          businessId,
          date: { [Op.between]: [startDate, endDate] }
        }
      });

      expenses.total = expenseData.reduce((sum, exp) => sum + parseFloat(exp.amount || 0), 0);
      expenses.list = expenseData;

      // Agrupar por categoría
      expenseData.forEach(exp => {
        const cat = exp.category || 'otros';
        expenses.byCategory[cat] = (expenses.byCategory[cat] || 0) + parseFloat(exp.amount || 0);
      });
    }

    // === INSUMOS: Costo de consumos (cantidad × costo unitario) ===
    let inventory = { total: 0, items: [], usageCount: 0 };
    if (enabledModules.inventory) {
      const usages = await InventoryUsage.findAll({
        where: {
          businessId,
          date: { [Op.between]: [startDate, endDate] }
        },
        include: [{ model: InventoryItem }]
      });

      inventory.usageCount = usages.length;
      usages.forEach(u => {
        const cost = parseFloat(u.InventoryItem?.unitCost || 0);
        const qty = parseFloat(u.quantity || 1);
        inventory.total += (cost * qty);
      });
    }

    // === CAJA: Turnos y movimientos ===
    let cashRegister = {
      totalOpeningAmount: 0,
      totalIncome: 0,
      totalExpenses: 0,
      totalWithdrawals: 0,
      totalDifference: 0,
      shiftsCount: 0,
      shifts: []
    };

    if (enabledModules.cashRegister) {
      const shifts = await CashRegisterShift.findAll({
        where: {
          businessId,
          openedAt: { [Op.between]: [startDate, endDate] }
        },
        include: [
          { model: require('../models').Employee, as: 'Employee' },
          { 
            model: require('../models').CashMovement, as: 'Movements',
            include: [{ model: require('../models').CashMovement, as: 'ReversedMovement' }]
          }
        ]
      });

      cashRegister.shiftsCount = shifts.length;

      // Para cada turno, obtener sus movimientos
      shifts.forEach(shift => {
        const movements = shift.Movements || [];
        
        let income = 0;
        let expenses = 0;
        let withdrawals = 0;

        movements.forEach(m => {
          const amount = parseFloat(m.amount);
          if (m.isReversal) {
            if (m.ReversedMovement?.type === 'income') income -= amount;
            else if (m.ReversedMovement?.type === 'expense') expenses -= amount;
            else if (m.ReversedMovement?.type === 'withdrawal') withdrawals -= amount;
          } else {
            if (m.type === 'income') {
              income += amount;
            } else if (m.type === 'expense') expenses += amount;
            else if (m.type === 'withdrawal') withdrawals += amount;
          }
        });

        cashRegister.totalOpeningAmount += parseFloat(shift.openingAmount || 0);
        cashRegister.totalIncome += income;
        cashRegister.totalExpenses += expenses;
        cashRegister.totalWithdrawals += withdrawals;
        cashRegister.totalDifference += (income - expenses - withdrawals);

        cashRegister.shifts.push({
          id: shift.id,
          openedAt: shift.openedAt,
          closedAt: shift.closedAt,
          employee: shift.Employee?.User?.name || shift.Employee?.name || 'Sistema',
          openingAmount: parseFloat(shift.openingAmount),
          income,
          expenses,
          withdrawals,
          difference: parseFloat(shift.difference || 0),
          status: shift.status,
          movementsCount: movements.length
        });
      });
    }

    // === CÁLCULOS FINALES ===
    const totalExpenses = expenses.total + inventory.total + totalCommissions;
    const netProfit = totalIncome - totalExpenses;
    const margin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

    // === ALERTAS: Citas terminadas sin movimiento en caja (Descuadres) ===
    const unrecordedAppointments = appointments.filter(apt => {
      // Buscar si existe un movimiento de ingreso para esta cita
      const hasMovement = movements.some(m => m.appointmentId === apt.id && (m.type === 'income' && !m.isReversal));
      return !hasMovement;
    }).map(apt => ({
      id: apt.id,
      clientName: apt.clientName,
      startTime: apt.startTime,
      finalPrice: parseFloat(apt.finalPrice || apt.basePrice || 0)
    }));

    const totalUnrecordedAmount = unrecordedAppointments.reduce((sum, apt) => sum + apt.finalPrice, 0);

    res.json({
      period: periodInfo.type === 'month' ? { year, month, startDate, endDate } : { startDate, endDate, type: periodInfo.type },
      summary: {
        totalIncome,
        cashIncome,
        transferIncome,
        totalDiscounts,
        totalExpenses,
        totalCommissions,
        inventoryCost: inventory.total,
        netProfit,
        margin,
        unrecordedIncome: totalUnrecordedAmount
      },
      details: {
        appointments: appointmentCount,
        unrecordedAppointments,
        expenses,
        inventory,
        cashRegister
      },
      enabledModules
    });
  } catch (error) {
    console.error('Error en informe financiero:', error);
    res.status(500).json({ error: 'Error al generar el informe financiero' });
  }
};
