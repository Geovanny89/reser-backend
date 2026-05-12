const { CashRegisterShift, CashMovement, Employee, Appointment, Expense, Business, User } = require('../../models');
const ExcelJS = require('exceljs');

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
        { model: User, as: 'Creator' },
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
      { header: 'G. Operativos', key: 'expenses',        width: 16 },
      { header: 'G. Fijos',      key: 'fixed',           width: 16 },
      { header: 'Insumos',       key: 'supplies',        width: 16 },
      { header: 'Retiros',       key: 'withdrawals',     width: 16 },
      { header: 'Saldo Operativo',key: 'expectedAmount',  width: 18 },
      { header: 'Monto Real',    key: 'closingAmount',   width: 16 },
      { header: 'Diferencia',    key: 'difference',      width: 14 },
      { header: 'Estado',        key: 'status',          width: 12 },
      { header: '# Movimientos', key: 'movCount',        width: 14 },
    ];

    const headerRowS = summarySheet.getRow(1);
    headerRowS.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    headerRowS.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    headerRowS.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRowS.height = 22;

    shifts.forEach(shift => {
      let income = 0;
      let expenses = 0;
      let withdrawals = 0;
      let totalSupplies = 0;
      let totalFixedExpenses = 0;

      shift.Movements.forEach(m => {
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
          if (m.type === 'income') income += amount;
          else if (m.type === 'expense') {
            if (m.category === 'supplies') totalSupplies += amount;
            else if (m.category === 'fixed') totalFixedExpenses += amount;
            else expenses += amount;
          }
          else if (m.type === 'withdrawal') withdrawals += amount;
        }
      });

      const expectedAmount = parseFloat(shift.openingAmount) + income - expenses - withdrawals - totalSupplies;
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
        fixed:          totalFixedExpenses,
        supplies:       totalSupplies,
        withdrawals,
        expectedAmount,
        closingAmount:  shift.closingAmount != null ? parseFloat(shift.closingAmount) : '-',
        difference:     diff,
        status:         shift.status === 'open' ? 'Abierto' : 'Cerrado',
        movCount:       shift.Movements.length,
      });

      if (diff !== null) {
        const diffCell = row.getCell('difference');
        diffCell.font = { color: { argb: diff < 0 ? 'FFDC2626' : diff > 0 ? 'FF059669' : 'FF374151' }, bold: true };
      }
    });

    ['openingAmount','income','expenses','fixed','supplies','withdrawals','expectedAmount','closingAmount','difference'].forEach(col => {
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
      const sorted = [...shift.Movements].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      sorted.forEach(mov => {
        const origin = mov.appointmentId ? `Cita #${mov.appointmentId.slice(0, 8)}` : mov.expenseId ? `Gasto #${mov.expenseId.slice(0, 8)}` : 'Manual';
        let typeLabel = typeLabels[mov.type] || mov.type;
        if (mov.isReversal) {
          const originalType = mov.ReversedMovement?.type === 'income' ? 'INGRESO' : 'GASTO/RETIRO';
          typeLabel = `ANULACIÓN ${originalType}`;
        }

        let finalAmount = parseFloat(mov.amount);
        const isNegative = mov.type === 'expense' || mov.type === 'withdrawal' || (mov.isReversal && mov.ReversedMovement?.type === 'income');
        if (isNegative) finalAmount = -finalAmount;

        let reversalStatus = mov.isReversal ? 'SÍ (Anulación)' : (mov.Reversal ? 'SÍ (Reversado)' : 'No');
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
        
        const amountCell = row.getCell('amount');
        if (mov.type === 'income') amountCell.font = { color: { argb: 'FF059669' }, bold: true };
        else amountCell.font = { color: { argb: 'FFDC2626' }, bold: true };

        if (mov.isReversal || mov.Reversal) {
          row.eachCell(cell => {
            cell.font = { ...cell.font, italic: true, color: { argb: 'FF9CA3AF' } };
          });
        }
      });
    });

    detailSheet.getColumn('amount').numFmt = '#,##0';
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
  exportHistoryToExcel
};
