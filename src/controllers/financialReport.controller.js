const { Appointment, Expense, InventoryUsage, InventoryItem, Deposit, Business, CashRegisterShift, CashMovement } = require('../models');
const { Op } = require('sequelize');

exports.getFinancialReport = async (req, res) => {
  try {
    const { businessId, year, month, startDate: queryStartDate, endDate: queryEndDate } = req.query;
    
    if (!businessId) {
      return res.status(400).json({ error: 'businessId es requerido' });
    }

    // Verificar que el negocio tiene los módulos habilitados
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const enabledModules = business.enabledModules || {};

    // Calcular fechas del período
    let startDate, endDate, periodInfo;
    
    if (queryStartDate && queryEndDate) {
      // Usar fechas personalizadas
      startDate = queryStartDate;
      endDate = queryEndDate;
      periodInfo = { startDate, endDate, type: 'custom' };
    } else if (year && month) {
      // Modo legacy: fechas del mes
      startDate = `${year}-${month.padStart(2, '0')}-01`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      endDate = `${year}-${month.padStart(2, '0')}-${lastDay}`;
      periodInfo = { year, month, startDate, endDate, type: 'month' };
    } else {
      return res.status(400).json({ error: 'Debe proporcionar year+month o startDate+endDate' });
    }

    // === INGRESOS: Citas completadas en el mes ===
    const appointments = await Appointment.findAll({
      where: {
        businessId,
        status: 'done',
        startTime: { [Op.between]: [new Date(startDate), new Date(`${endDate}T23:59:59`)] }
      }
    });

    const totalIncome = appointments.reduce((sum, apt) => {
      const price = (apt.finalPrice !== null && apt.finalPrice !== undefined) ? apt.finalPrice : (apt.basePrice || 0);
      return sum + parseFloat(price);
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
        include: [{ model: InventoryItem, attributes: ['name', 'unit', 'costPerUnit'] }]
      });

      inventory.items = usages.map(u => {
        const costPerUnit = parseFloat(u.InventoryItem?.costPerUnit || 0);
        const quantity = parseFloat(u.quantity || 0);
        const totalCost = costPerUnit * quantity;
        
        return {
          name: u.InventoryItem?.name || 'Insumo desconocido',
          unit: u.InventoryItem?.unit || 'unidad',
          quantity,
          costPerUnit,
          totalCost,
          date: u.date,
          notes: u.notes
        };
      });

      inventory.total = inventory.items.reduce((sum, item) => sum + item.totalCost, 0);
      inventory.usageCount = usages.length;
    }

    // === DEPÓSITOS: Flujo de caja ===
    let deposits = { 
      totalReceived: 0, 
      totalApplied: 0, 
      totalHeld: 0,
      count: 0 
    };
    if (enabledModules.deposits) {
      const depositData = await Deposit.findAll({
        where: {
          businessId,
          date: { [Op.between]: [startDate, endDate] }
        }
      });

      deposits.count = depositData.length;
      
      depositData.forEach(d => {
        const amount = parseFloat(d.amount || 0);
        deposits.totalReceived += amount;
        
        if (d.status === 'held') {
          deposits.totalHeld += amount;
        } else if (d.status === 'applied') {
          deposits.totalApplied += amount;
        }
      });
    }

    // === CAJA: Turnos y movimientos de efectivo ===
    let cashRegister = {
      shifts: [],
      totalOpeningAmount: 0,
      totalIncome: 0,
      totalExpenses: 0,
      totalWithdrawals: 0,
      totalDifference: 0,
      shiftsCount: 0
    };
    if (enabledModules.cashRegister) {
      const shifts = await CashRegisterShift.findAll({
        where: {
          businessId,
          openedAt: { [Op.between]: [new Date(startDate), new Date(`${endDate}T23:59:59`)] }
        },
        include: [{ model: require('../models').Employee, as: 'Employee' }]
      });

      cashRegister.shiftsCount = shifts.length;

      // Para cada turno, obtener sus movimientos
      for (const shift of shifts) {
        const movements = await CashMovement.findAll({
          where: { shiftId: shift.id }
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

        cashRegister.totalOpeningAmount += parseFloat(shift.openingAmount || 0);
        cashRegister.totalIncome += income;
        cashRegister.totalExpenses += expenses;
        cashRegister.totalWithdrawals += withdrawals;

        // Diferencia del turno = ingresos - gastos - retiros (flujo neto)
        const shiftDifference = income - expenses - withdrawals;
        cashRegister.totalDifference += shiftDifference;

        cashRegister.shifts.push({
          id: shift.id,
          openedAt: shift.openedAt,
          closedAt: shift.closedAt,
          openingAmount: parseFloat(shift.openingAmount),
          closingAmount: shift.closingAmount ? parseFloat(shift.closingAmount) : null,
          expectedAmount: shift.expectedAmount ? parseFloat(shift.expectedAmount) : null,
          difference: shift.difference ? parseFloat(shift.difference) : null,
          status: shift.status,
          employee: shift.Employee?.name || null,
          movementsCount: movements.length,
          income,
          expenses,
          withdrawals
        });
      }
    }

    // === CÁLCULOS FINALES ===
    const totalExpenses = expenses.total + inventory.total;
    const netProfit = totalIncome - totalExpenses;
    const margin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

    res.json({
      period: periodInfo.type === 'month' ? { year, month, startDate, endDate } : { startDate, endDate, type: periodInfo.type },
      summary: {
        totalIncome,
        totalExpenses,
        inventoryCost: inventory.total,
        netProfit,
        margin: parseFloat(margin.toFixed(2)),
        appointmentCount
      },
      details: {
        income: {
          appointments: appointments.map(a => ({
            id: a.id,
            date: a.startTime,
            client: a.clientName,
            amount: parseFloat((a.finalPrice !== null && a.finalPrice !== undefined) ? a.finalPrice : (a.basePrice || 0))
          }))
        },
        expenses: {
          total: expenses.total,
          byCategory: expenses.byCategory,
          list: expenses.list.map(e => ({
            id: e.id,
            date: e.date,
            category: e.category,
            description: e.description,
            amount: parseFloat(e.amount),
            paymentMethod: e.paymentMethod
          }))
        },
        inventory,
        deposits: {
          totalReceived: deposits.totalReceived,
          totalHeld: deposits.totalHeld,
          totalApplied: deposits.totalApplied,
          count: deposits.count
        },
        cashRegister: {
          shiftsCount: cashRegister.shiftsCount,
          totalOpeningAmount: cashRegister.totalOpeningAmount,
          totalIncome: cashRegister.totalIncome,
          totalExpenses: cashRegister.totalExpenses,
          totalWithdrawals: cashRegister.totalWithdrawals,
          totalDifference: cashRegister.totalDifference,
          shifts: cashRegister.shifts
        }
      },
      enabledModules
    });

  } catch (e) {
    console.error('[getFinancialReport] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
