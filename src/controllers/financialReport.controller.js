const { Appointment, Expense, InventoryUsage, InventoryItem, Deposit, Business, CashRegisterShift, CashMovement } = require('../models');
const { Op } = require('sequelize');

// Helper: parsea un valor como float y retorna 0 si es NaN, null o undefined
const safeFloat = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
};

exports.getFinancialReport = async (req, res) => {
  try {
    const { businessId, year, month, startDate: queryStartDate, endDate: queryEndDate, employeeId } = req.query;
    console.log('FINANCIAL_REPORT_QUERY:', { businessId, queryStartDate, queryEndDate, employeeId, year, month });
    
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
          attributes: ['id', 'employeeId', 'startTime', 'finalPrice', 'basePrice', 'discountApplied', 'extraServices'],
          include: [
            { model: require('../models').Employee, attributes: ['id', 'commissionPct'] },
            {
              model: require('../models').AppointmentEmployee,
              as: 'AdditionalEmployees',
              attributes: ['id', 'employeeId'],
              include: [{ model: require('../models').Employee, attributes: ['id', 'commissionPct'] }]
            }
          ]
        }
      ]
    });

    // Helper: verifica si un empleado participa en una cita (principal o adicional)
    const employeeIsInAppointment = (apt, empId) => {
      if (!apt || !empId) return false;
      if (String(apt.employeeId) === String(empId)) return true;
      if (apt.AdditionalEmployees && Array.isArray(apt.AdditionalEmployees)) {
        return apt.AdditionalEmployees.some(ae => String(ae.employeeId) === String(empId));
      }
      return false;
    };

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
        // CORRECCIÓN: Verificar que la cita asociada al movimiento esté dentro del rango de fecha
        // Esto evita que citas de otros días (pero cobradas hoy) alteren el reporte diario
        if (m.Appointment) {
          const apptTime = new Date(m.Appointment.startTime);
          if (apptTime < startDate || apptTime > endDate) {
            return; // Omitir si la cita no es del periodo solicitado
          }
        }

        // Si hay filtro de empleado, verificar que el empleado sea principal o adicional en la cita
        if (employeeId && employeeId !== 'all' && employeeId !== '') {
          if (!employeeIsInAppointment(m.Appointment, employeeId)) {
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

    // NOTA: No filtramos por employeeId directamente en el WHERE porque
    // si el empleado es adicional, el appointment.employeeId sería el principal.
    // Filtramos después del query.

    const appointments = await Appointment.findAll({
      where: appointmentsWhere,
      include: [
        {
          model: require('../models').Employee,
          attributes: ['id', 'commissionPct']
        },
        {
          model: require('../models').Service,
          attributes: ['price']
        },
        {
          model: require('../models').AppointmentEmployee,
          as: 'AdditionalEmployees',
          attributes: ['id', 'employeeId'],
          include: [{ model: require('../models').Employee, attributes: ['id', 'commissionPct'] }]
        }
      ]
    });

    // Helper: Distribuye ingresos de una cita entre sus empleados
    // (misma lógica que splitRevenueByEmployee en el frontend y commissions.js)
    const splitRevenue = (apt) => {
      // CORRECCIÓN CRÍTICA: igual que en commissions.js, finalPrice es el valor real
      const finalPriceVal = safeFloat(apt.finalPrice);
      const basePrice = safeFloat(apt.basePrice) || safeFloat(apt.Service?.price);
      const additionalAmount = safeFloat(apt.additionalAmount);
      const discountApplied = safeFloat(apt.discountApplied);
      const hasFinal = finalPriceVal > 0;

      const parts = [];
      const principalId = apt.employeeId;
      const principalName = apt.Employee?.User?.name || apt.Employee?.name || 'Sin asignar';
      const principalCommissionPct = safeFloat(apt.Employee?.commissionPct);

      // 1. Servicios adicionales primero para calcular la suma
      const extraParts = [];
      let sumExtraPrices = 0;
      const extraServices = apt.extraServices && Array.isArray(apt.extraServices) ? apt.extraServices : [];

      extraServices.forEach((es) => {
        const empId = es.employeeId;
        const price = safeFloat(es.price);
        sumExtraPrices += price;

        let empName = 'Sin asignar';
        let empComm = 0;
        if (empId) {
          const inAdditional = apt.AdditionalEmployees?.find?.(
            (ae) => String(ae.employeeId) === String(empId)
          );
          if (inAdditional?.Employee) {
            empName = inAdditional.Employee.User?.name || inAdditional.Employee.name || empName;
            empComm = safeFloat(inAdditional.Employee.commissionPct);
          } else if (String(empId) === String(principalId)) {
            empName = principalName;
            empComm = principalCommissionPct;
          }
        }

        extraParts.push({
          employeeId: empId ? String(empId) : `extra-${es.serviceId || es.name}`,
          name: empName,
          commissionPct: empComm,
          gross: price,
        });
      });

      // 2. Empleado principal recibe (total_cita - suma_extras), según corresponda
      let principalGross;
      if (hasFinal) {
        principalGross = Math.max(0, finalPriceVal - sumExtraPrices);
      } else {
        principalGross = Math.max(0, basePrice + additionalAmount - sumExtraPrices);
      }
      if (principalId) {
        parts.push({
          employeeId: String(principalId),
          name: principalName,
          commissionPct: principalCommissionPct,
          gross: principalGross,
        });
      }
      parts.push(...extraParts);

      // 3. Aplicar descuento proporcional SOLO si no hay finalPrice (ya lo incluye)
      const totalGross = parts.reduce((s, p) => s + p.gross, 0);
      return parts.map((p, idx) => {
        let discountShare = 0;
        if (!hasFinal && discountApplied > 0 && totalGross > 0) {
          discountShare = (p.gross / totalGross) * discountApplied;
          if (idx === parts.length - 1) {
            const alreadyApplied = parts.reduce((s, p2, i2) => {
              if (i2 >= idx) return s;
              return s + (p2.gross / totalGross) * discountApplied;
            }, 0);
            discountShare = discountApplied - alreadyApplied;
          }
        }
        return {
          ...p,
          revenue: Math.max(0, p.gross - discountShare),
        };
      });
    };

    // Filtrar citas si hay empleado seleccionado (principal o adicional)
    const filteredAppointments = appointments.filter(apt => {
      if (!employeeId || employeeId === 'all' || employeeId === '') return true;
      return employeeIsInAppointment(apt, employeeId);
    });

    // Calcular comisiones totales distribuyendo por empleado
    const totalCommissions = filteredAppointments.reduce((sum, apt) => {
      const splits = splitRevenue(apt);
      let totalCommissionThisApt = 0;

      splits.forEach((split) => {
        let earned;
        if (apt.employeeEarns !== undefined && apt.employeeEarns !== null &&
            String(split.employeeId) === String(apt.employeeId)) {
          earned = safeFloat(apt.employeeEarns);
        } else {
          earned = (split.revenue * safeFloat(split.commissionPct)) / 100;
        }
        totalCommissionThisApt += earned;
      });

      return sum + totalCommissionThisApt;
    }, 0);

    const appointmentCount = filteredAppointments.length;

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

    // === INSUMOS: Costo de consumos (cantidad × costo unitario) + Costo directo por cita ===
    let inventory = { total: 0, items: [], usageCount: 0 };
    
    // Sumar suppliesCost de las citas del período (filtradas si hay empleado)
    const suppliesFromAppts = filteredAppointments.reduce((sum, apt) => sum + parseFloat(apt.suppliesCost || 0), 0);
    inventory.total += suppliesFromAppts;

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
        const cost = parseFloat(u.InventoryItem?.costPerUnit || 0);
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

    // === ALERTAS: Citas terminadas sin movimiento en caja (Descuadres) ===
    const unrecordedAppointments = filteredAppointments.filter(apt => {
      // Buscar si existe un movimiento de ingreso para esta cita
      const hasMovement = movements.some(m => m.appointmentId === apt.id && (m.type === 'income' && !m.isReversal));
      return !hasMovement;
    }).map(apt => {
      // Sanitizar precio: usar safeFloat para evitar que NaN de la BD contamine el total
      const price = safeFloat(apt.finalPrice) || safeFloat(apt.basePrice) || safeFloat(apt.Service?.price);
      return {
        id: apt.id,
        clientName: apt.clientName,
        startTime: apt.startTime,
        finalPrice: price
      };
    });

    const totalUnrecordedAmount = unrecordedAppointments.reduce((sum, apt) => sum + safeFloat(apt.finalPrice), 0);

    // Sumar el ingreso no registrado (citas sin movimiento de caja) al ingreso total para que coincida con el dashboard
    const adjustedTotalIncome = totalIncome + totalUnrecordedAmount;
    // Asumimos que lo no registrado fue en efectivo (por ser el método por defecto)
    const adjustedCashIncome = cashIncome + totalUnrecordedAmount;

    // === CÁLCULOS FINALES ===
    const totalExpenses = expenses.total + inventory.total + totalCommissions;
    const netProfit = adjustedTotalIncome - totalExpenses;
    const margin = adjustedTotalIncome > 0 ? (netProfit / adjustedTotalIncome) * 100 : 0;

    res.json({
      period: periodInfo.type === 'month' ? { year, month, startDate, endDate } : { startDate, endDate, type: periodInfo.type },
      summary: {
        totalIncome: adjustedTotalIncome,
        cashIncome: adjustedCashIncome,
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
