const { Appointment, Expense, InventoryUsage, InventoryItem, Deposit, Business } = require('../models');
const { Op } = require('sequelize');

exports.getFinancialReport = async (req, res) => {
  try {
    const { businessId, year, month } = req.query;
    
    if (!businessId || !year || !month) {
      return res.status(400).json({ error: 'businessId, year y month son requeridos' });
    }

    // Verificar que el negocio tiene los módulos habilitados
    const business = await Business.findByPk(businessId);
    if (!business) return res.status(404).json({ error: 'Negocio no encontrado' });
    
    const enabledModules = business.enabledModules || {};

    // Fechas del mes
    const startDate = `${year}-${month.padStart(2, '0')}-01`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const endDate = `${year}-${month.padStart(2, '0')}-${lastDay}`;

    // === INGRESOS: Citas completadas en el mes ===
    const appointments = await Appointment.findAll({
      where: {
        businessId,
        status: 'done',
        startTime: { [Op.between]: [new Date(startDate), new Date(`${endDate}T23:59:59`)] }
      }
    });

    const totalIncome = appointments.reduce((sum, apt) => 
      sum + parseFloat(apt.finalPrice || apt.basePrice || 0), 0
    );
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

    // === CÁLCULOS FINALES ===
    const totalExpenses = expenses.total + inventory.total;
    const netProfit = totalIncome - totalExpenses;
    const margin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

    res.json({
      period: { year, month, startDate, endDate },
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
            amount: parseFloat(a.finalPrice || a.basePrice || 0)
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
        }
      },
      enabledModules
    });

  } catch (e) {
    console.error('[getFinancialReport] Error:', e);
    res.status(500).json({ error: e.message });
  }
};
