const { CashRegisterShift, CashMovement, Employee, Appointment, Expense, Business, User } = require('../models');
const ExcelJS = require('exceljs');

/**
 * Obtener turno de caja activo del negocio
 */
async function getActiveShift(req, res) {
  try {
    const { businessId } = req.query;

    // Obtener configuración del negocio
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

    // Calcular total actual del turno con lógica de Netos
    const movements = await CashMovement.findAll({
      where: { shiftId: activeShift.id },
      include: [{ model: CashMovement, as: 'ReversedMovement' }] // Para saber qué tipo se está revirtiendo
    });

    let income = 0;
    let expenses = 0;
    let withdrawals = 0;

    movements.forEach(m => {
      const amount = parseFloat(m.amount);
      
      if (m.isReversal) {
        // Si es una reversa, restamos del total original
        // m.type es el tipo de la reversa (el opuesto al original)
        // m.ReversedMovement.type es el tipo original que estamos anulando
        if (m.ReversedMovement?.type === 'income') {
          income -= amount; // Restar del total de ingresos
        } else if (m.ReversedMovement?.type === 'expense') {
          expenses -= amount; // Restar del total de gastos
        } else if (m.ReversedMovement?.type === 'withdrawal') {
          withdrawals -= amount; // Restar del total de retiros
        }
      } else {
        // Si es un movimiento normal, sumamos
        if (m.type === 'income') {
          // Excluir transferencias si la configuración lo pide
          if (!includeTransfers && m.paymentMethod === 'transfer') return;
          income += amount;
        } else if (m.type === 'expense') {
          expenses += amount;
        } else if (m.type === 'withdrawal') {
          withdrawals += amount;
        }
      }
    });

    const currentAmount = parseFloat(activeShift.openingAmount) + income - expenses - withdrawals;

    res.json({
      activeShift: {
        ...activeShift.toJSON(),
        currentAmount,
        totalIncome: income,
        totalExpenses: expenses,
        totalWithdrawals: withdrawals,
        movementsCount: movements.length
      }
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
    
    // Verificar que no haya turno activo
    const existingActive = await CashRegisterShift.findOne({
      where: {
        businessId,
        status: 'open'
      }
    });

    if (existingActive) {
      return res.status(400).json({ error: 'Ya existe un turno activo. Ciérrelo antes de abrir uno nuevo.' });
    }

    const shift = await CashRegisterShift.create({
      businessId,
      employeeId: employeeId || null,
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

    // Calcular montos netos
    const movements = await CashMovement.findAll({
      where: { shiftId },
      include: [{ model: CashMovement, as: 'ReversedMovement' }]
    });

    const business = await Business.findByPk(shift.businessId);
    const includeTransfers = business?.includeTransfersInCashRegister !== false;

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
          if (!includeTransfers && m.paymentMethod === 'transfer') return;
          income += amount;
        } else if (m.type === 'expense') expenses += amount;
        else if (m.type === 'withdrawal') withdrawals += amount;
      }
    });

    const expectedAmount = parseFloat(shift.openingAmount) + income - expenses - withdrawals;
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
      totalIncome: income,
      totalExpenses: expenses,
      totalWithdrawals: withdrawals,
      movementsCount: movements.length
    });
  } catch (error) {
    console.error('Error cerrando turno:', error);
    res.status(500).json({ error: 'Error al cerrar turno de caja' });
  }
}

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
        { model: CashMovement, as: 'Reversal' } // Nuevo: saber si ya tiene reversa
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({ movements });
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
    const { businessId, shiftId, type, amount, paymentMethod, description, notes, appointmentId, expenseId } = req.body;

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

    // Verificar que el turno esté activo
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
      createdBy: req.user?.id
    });

    // Recargar turno con datos actualizados
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

    const currentAmount = parseFloat(updatedShift.openingAmount) + income - expenses - withdrawals;

    res.status(201).json({
      movement,
      shift: {
        ...updatedShift.toJSON(),
        currentAmount,
        totalIncome: income,
        totalExpenses: expenses,
        totalWithdrawals: withdrawals,
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

    // Para cada turno, obtener resumen de movimientos
    const shiftsWithSummary = await Promise.all(
      shifts.map(async (shift) => {
        const movements = await CashMovement.findAll({
          where: { shiftId: shift.id },
          include: [{ model: CashMovement, as: 'ReversedMovement' }]
        });

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
            if (m.type === 'income') income += amount;
            else if (m.type === 'expense') expenses += amount;
            else if (m.type === 'withdrawal') withdrawals += amount;
          }
        });

        return {
          ...shift.toJSON(),
          totalIncome: income,
          totalExpenses: expenses,
          totalWithdrawals: withdrawals,
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

/**
 * Corregir movimiento de caja (crear reversa + nuevo movimiento)
 * Mantiene trazabilidad auditando el error en lugar de editarlo
 */
async function correctMovement(req, res) {
  try {
    const { movementId } = req.params;
    const { 
      correctAmount, 
      reason, 
      type,            // Nuevo: permitir corregir el tipo (ingreso/gasto)
      paymentMethod,   // Nuevo: permitir corregir método
      description      // Nuevo: permitir corregir descripción
    } = req.body;

    const movement = await CashMovement.findByPk(movementId);
    if (!movement) {
      return res.status(404).json({ error: 'Movimiento no encontrado' });
    }

    if (movement.isReversal) {
      return res.status(400).json({ error: 'No se pueden corregir movimientos de reversa' });
    }

    const newAmount = parseFloat(correctAmount);
    // Cambiado: permitir 0 para anular completamente
    if (!Number.isFinite(newAmount) || newAmount < 0) {
      return res.status(400).json({ error: 'El monto debe ser un número mayor o igual a 0' });
    }

    // Verificar que el turno esté activo
    const shift = await CashRegisterShift.findByPk(movement.shiftId);
    if (shift.status !== 'open') {
      return res.status(400).json({ error: 'No se pueden corregir movimientos de turnos cerrados' });
    }

    // No permitir corregir movimientos asociados a citas o gastos automáticos (esos tienen su propio flujo)
    if (movement.appointmentId || movement.expenseId) {
      return res.status(400).json({ error: 'No se pueden corregir movimientos automáticos. Edite el origen si es necesario.' });
    }

    const oldAmount = parseFloat(movement.amount);

    // 1. Crear movimiento de REVERSA (Anula el efecto del original)
    // si el original fue income (+), la reversa debe restar (-)
    // si el original fue expense/withdrawal (-), la reversa debe sumar (+)
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

    // 2. Crear nuevo movimiento CORREGIDO (solo si el monto es > 0)
    let corrected = null;
    if (newAmount > 0) {
      corrected = await CashMovement.create({
        businessId: movement.businessId,
        shiftId: movement.shiftId,
        type: type || movement.type, // Usar el nuevo tipo si viene, si no el original
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
    // En caja real no se deben eliminar movimientos para preservar auditoría.
    // Use el endpoint de corrección (reversa + nuevo movimiento).
    return res.status(400).json({
      error: 'No se permite eliminar movimientos de caja. Usa "Corregir" para mantener trazabilidad.'
    });
  } catch (error) {
    console.error('Error eliminando movimiento:', error);
    res.status(500).json({ error: 'Error al eliminar movimiento' });
  }
}

/**
 * Exportar historial de caja a Excel
 */
async function exportHistoryToExcel(req, res) {
  try {
    const { businessId, startDate, endDate, shiftId } = req.query;

    const whereClause = { businessId };
    
    if (startDate && endDate) {
      whereClause.openedAt = {
        [require('sequelize').Op.between]: [new Date(startDate), new Date(`${endDate}T23:59:59`)]
      };
    }
    if (shiftId) {
      whereClause.id = shiftId;
    }

    const shifts = await CashRegisterShift.findAll({
      where: whereClause,
      include: [
        { 
          model: Employee, as: 'Employee',
          include: [{ model: User, as: 'User' }] 
        },
        { model: User, as: 'Creator' }, // Respaldo para cuando el Admin abre caja
        {
          model: CashMovement, as: 'Movements',
          include: [
            { 
              model: Appointment, as: 'Appointment',
              include: [{ 
                model: Employee, as: 'Employee',
                include: [{ model: User, as: 'User' }]
              }]
            },
            { model: Expense, as: 'Expense' },
            { model: CashMovement, as: 'ReversedMovement' },
            { model: CashMovement, as: 'Reversal' }
          ]
        }
      ],
      order: [['openedAt', 'DESC']]
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'K-Dice';
    workbook.created = new Date();

    // ==================== HOJA 1: RESUMEN DE TURNOS ====================
    const summarySheet = workbook.addWorksheet('Resumen de Turnos');
    summarySheet.columns = [
      { header: 'Fecha',         key: 'date',           width: 18 },
      { header: 'Hora Apertura', key: 'openTime',        width: 15 },
      { header: 'Hora Cierre',   key: 'closeTime',       width: 15 },
      { header: 'Empleado',      key: 'employee',        width: 22 },
      { header: 'Monto Inicial', key: 'openingAmount',   width: 16 },
      { header: 'Ingresos',      key: 'income',          width: 16 },
      { header: 'Gastos',        key: 'expenses',        width: 16 },
      { header: 'Retiros',       key: 'withdrawals',     width: 16 },
      { header: 'Monto Esperado',key: 'expectedAmount',  width: 16 },
      { header: 'Monto Real',    key: 'closingAmount',   width: 16 },
      { header: 'Diferencia',    key: 'difference',      width: 14 },
      { header: 'Estado',        key: 'status',          width: 12 },
      { header: '# Movimientos', key: 'movCount',        width: 14 },
    ];

    // Estilo encabezado
    const headerRowS = summarySheet.getRow(1);
    headerRowS.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    headerRowS.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    headerRowS.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRowS.height = 22;

    shifts.forEach(shift => {
      let income = 0;
      let expenses = 0;
      let withdrawals = 0;

      shift.Movements.forEach(m => {
        const amount = parseFloat(m.amount);
        if (m.isReversal) {
          if (m.ReversedMovement?.type === 'income') income -= amount;
          else if (m.ReversedMovement?.type === 'expense') expenses -= amount;
          else if (m.ReversedMovement?.type === 'withdrawal') withdrawals -= amount;
        } else {
          if (m.type === 'income') income += amount;
          else if (m.type === 'expense') expenses += amount;
          else if (m.type === 'withdrawal') withdrawals += amount;
        }
      });

      const expectedAmount = parseFloat(shift.openingAmount) + income - expenses - withdrawals;
      const diff = shift.closingAmount != null ? parseFloat(shift.closingAmount) - expectedAmount : null;

      const shiftEmp = shift.Employee || shift.employee;
      const shiftEmpName = shiftEmp?.User?.name || shiftEmp?.user?.name || shiftEmp?.name || shift.Creator?.name || '-';

      const row = summarySheet.addRow({
        date:           new Date(shift.openedAt).toLocaleDateString('es-CO'),
        openTime:       new Date(shift.openedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        closeTime:      shift.closedAt ? new Date(shift.closedAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '-',
        employee:       shiftEmpName,
        openingAmount:  parseFloat(shift.openingAmount),
        income,
        expenses,
        withdrawals,
        expectedAmount,
        closingAmount:  shift.closingAmount != null ? parseFloat(shift.closingAmount) : '-',
        difference:     diff,
        status:         shift.status === 'open' ? 'Abierto' : 'Cerrado',
        movCount:       shift.Movements.length,
      });

      // Colorear diferencia
      if (diff !== null) {
        const diffCell = row.getCell('difference');
        diffCell.font = { color: { argb: diff < 0 ? 'FFDC2626' : diff > 0 ? 'FF059669' : 'FF374151' }, bold: true };
      }
    });

    // Formato de moneda en columnas numéricas
    ['openingAmount','income','expenses','withdrawals','expectedAmount','closingAmount','difference'].forEach(col => {
      summarySheet.getColumn(col).numFmt = '#,##0';
    });

    // ==================== HOJA 2: DETALLE DE MOVIMIENTOS ====================
    const detailSheet = workbook.addWorksheet('Detalle de Movimientos');
    detailSheet.columns = [
      { header: 'Fecha',         key: 'date',         width: 14 },
      { header: 'Hora',          key: 'time',         width: 10 },
      { header: 'Turno',         key: 'shiftDate',    width: 18 },
      { header: 'Tipo',          key: 'type',         width: 12 },
      { header: 'Descripción',   key: 'description',  width: 35 },
      { header: 'Método Pago',   key: 'paymentMethod',width: 16 },
      { header: 'Monto',         key: 'amount',       width: 14 },
      { header: 'Profesional/Empleado', key: 'employee', width: 22 },
      { header: 'Origen',        key: 'origin',       width: 20 },
      { header: '¿Reversa?',     key: 'isReversal',   width: 10 },
      { header: 'Notas',         key: 'notes',        width: 30 },
    ];

    const headerRowD = detailSheet.getRow(1);
    headerRowD.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    headerRowD.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    headerRowD.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRowD.height = 22;

    const typeLabels   = { income: 'Ingreso', expense: 'Gasto', withdrawal: 'Retiro' };
    const methodLabels = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', nequi: 'Nequi', daviplata: 'DaviPlata' };

    shifts.forEach(shift => {
      const shiftDateStr = new Date(shift.openedAt).toLocaleDateString('es-CO');

      // Ordenar movimientos por fecha ascendente para cuadre
      const sorted = [...shift.Movements].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      sorted.forEach(mov => {
        const origin = mov.appointmentId
          ? `Cita #${mov.appointmentId.slice(0, 8)}`
          : mov.expenseId
            ? `Gasto #${mov.expenseId.slice(0, 8)}`
            : 'Manual';

        let typeLabel = typeLabels[mov.type] || mov.type;
        if (mov.isReversal) {
          const originalType = mov.ReversedMovement?.type === 'income' ? 'INGRESO' : 'GASTO/RETIRO';
          typeLabel = `ANULACIÓN ${originalType}`;
        }

        // Determinar si el monto debe ser negativo para el Excel
        let finalAmount = parseFloat(mov.amount);
        // Si es gasto, retiro o una reversa de un ingreso, es una salida/resta de dinero
        const isNegative = mov.type === 'expense' || mov.type === 'withdrawal' || (mov.isReversal && mov.ReversedMovement?.type === 'income');
        
        if (isNegative) {
          finalAmount = -finalAmount;
        }

        let reversalStatus = 'No';
        if (mov.isReversal) {
          reversalStatus = 'SÍ (Anulación)';
        } else if (mov.Reversal) {
          reversalStatus = 'SÍ (Reversado)';
        }

        const shiftEmp = shift.Employee || shift.employee;
        const movEmp = mov.Appointment?.Employee || mov.Appointment?.employee || shiftEmp;
        const empName = movEmp?.User?.name || movEmp?.user?.name || movEmp?.name || shift.Creator?.name || '-';

        const row = detailSheet.addRow({
          date:          new Date(mov.createdAt).toLocaleDateString('es-CO'),
          time:          new Date(mov.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
          shiftDate:     shiftDateStr,
          type:          typeLabel,
          description:   mov.description,
          paymentMethod: methodLabels[mov.paymentMethod] || mov.paymentMethod,
          amount:        finalAmount,
          employee:      empName,
          origin:        origin,
          isReversal:    reversalStatus,
          notes:         mov.notes || '',
        });
        
        // Estilo visual para movimientos reversados o anulaciones
        if (mov.isReversal || mov.Reversal) {
          row.eachCell(cell => {
            cell.font = { color: { argb: 'FF999999' }, italic: true };
          });
        }

        // Color por tipo
        const amountCell = row.getCell('amount');
        if (mov.type === 'income') {
          amountCell.font = { color: { argb: 'FF059669' }, bold: true };
        } else {
          amountCell.font = { color: { argb: 'FFDC2626' }, bold: true };
        }

        // Tono gris para reversas
        if (mov.isReversal) {
          row.eachCell(cell => {
            cell.font = { ...cell.font, italic: true, color: { argb: 'FF9CA3AF' } };
          });
        }
      });
    });

    detailSheet.getColumn('amount').numFmt = '#,##0';

    // Congelar primera fila en ambas hojas
    summarySheet.views = [{ state: 'frozen', ySplit: 1 }];
    detailSheet.views  = [{ state: 'frozen', ySplit: 1 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=historial-caja-${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error exportando a Excel:', error);
    res.status(500).json({ error: 'Error al exportar a Excel' });
  }
}

module.exports = {
  getActiveShift,
  openShift,
  closeShift,
  getShiftMovements,
  createMovement,
  correctMovement,
  getShiftHistory,
  deleteMovement,
  exportHistoryToExcel
};
