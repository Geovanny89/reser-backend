const { Business, CashRegisterShift, CashMovement } = require('../../../models');

/**
 * Registra automáticamente un movimiento de caja cuando se completa una cita con pago en efectivo
 */
async function registerCashMovementForAppointment(appointment, userId) {
  try {
    // Registrar si el pago es en efectivo o transferencia
    if (!appointment.paymentMethod || !['cash', 'transfer'].includes(appointment.paymentMethod)) {
      console.log(`[Cash Register] Método de pago no válido para registro en caja (${appointment.paymentMethod}), omitiendo registro`);
      return;
    }

    // Si es transferencia, verificar si el negocio incluye transferencias en caja
    if (appointment.paymentMethod === 'transfer') {
      const business = await Business.findByPk(appointment.businessId);
      if (!business || !business.includeTransfersInCashRegister) {
        console.log(`[Cash Register] Negocio no incluye transferencias en caja (${appointment.businessId}), omitiendo registro`);
        return;
      }
    }

    // Buscar turno de caja activo
    const activeShift = await CashRegisterShift.findOne({
      where: {
        businessId: appointment.businessId,
        status: 'open'
      }
    });

    if (!activeShift) {
      console.log(`[Cash Register] No hay turno de caja activo para negocio ${appointment.businessId}`);
      return;
    }

    // Verificar si ya existe un movimiento para esta cita
    const existingMovement = await CashMovement.findOne({
      where: {
        appointmentId: appointment.id
      }
    });

    if (existingMovement) {
      console.log(`[Cash Register] Ya existe movimiento para cita ${appointment.id}`);
      return;
    }

    // Crear movimiento de caja
    const amountToRecord = (appointment.finalPrice !== null && appointment.finalPrice !== undefined) 
      ? appointment.finalPrice 
      : (appointment.Service?.price || 0);

    // Construir descripción incluyendo servicios extra
    let descriptionText = `Pago de cita: ${appointment.Service?.name || 'Servicio'}`;
    
    if (appointment.extraServices && Array.isArray(appointment.extraServices) && appointment.extraServices.length > 0) {
      const extrasText = appointment.extraServices.map(s => s.name).join(', ');
      descriptionText += ` (+ ${extrasText})`;
    }

    if (appointment.discountApplied && parseFloat(appointment.discountApplied) > 0) {
      descriptionText += ` (Desc: -$${parseFloat(appointment.discountApplied).toLocaleString()})`;
    }

    if (appointment.suppliesCost && parseFloat(appointment.suppliesCost) > 0) {
      descriptionText += ` (Insumos: -$${parseFloat(appointment.suppliesCost).toLocaleString()})`;
    }
    
    descriptionText += ` - ${appointment.clientName}`;

    await CashMovement.create({
      businessId: appointment.businessId,
      shiftId: activeShift.id,
      appointmentId: appointment.id,
      type: 'income',
      amount: amountToRecord,
      suppliesCost: appointment.suppliesCost || 0,
      paymentMethod: appointment.paymentMethod,
      description: descriptionText,
      createdBy: userId
    });

    // Si hay costo de insumos, registrar un gasto automático (opcional, pero solicitado por el usuario para "descontar")
    if (appointment.suppliesCost && parseFloat(appointment.suppliesCost) > 0) {
      await CashMovement.create({
        businessId: appointment.businessId,
        shiftId: activeShift.id,
        appointmentId: appointment.id,
        type: 'expense',
        amount: parseFloat(appointment.suppliesCost),
        paymentMethod: appointment.paymentMethod, // Usamos el mismo método para que cuadre el balance por método
        description: `Insumos: ${appointment.Service?.name || 'Servicio'} - ${appointment.clientName}`,
        notes: `Descuento automático de insumos para la cita #${appointment.id.slice(0, 8)}`,
        category: 'supplies',
        createdBy: userId
      });
      console.log(`[Cash Register] Gasto por insumos registrado para cita ${appointment.id}: $${appointment.suppliesCost}`);
    }

    console.log(`[Cash Register] Movimiento de ingreso registrado para cita ${appointment.id}: $${amountToRecord}`);
  } catch (error) {
    console.error('[Cash Register] Error registrando movimiento de caja:', error.message);
    // No lanzar error para no interrumpir el flujo principal
  }
}

/**
 * Reversa un movimiento de caja asociado a una cita (cuando se anula o cambia de estado)
 */
async function reverseCashMovementForAppointment(appointmentId, userId) {
  try {
    const movements = await CashMovement.findAll({
      where: {
        appointmentId,
        isReversal: false
      }
    });

    if (movements.length === 0) return;

    // Buscar turno de caja activo para el negocio
    const activeShift = await CashRegisterShift.findOne({
      where: {
        businessId: movements[0].businessId,
        status: 'open'
      }
    });

    if (!activeShift) {
      console.log(`[Cash Register] No hay turno abierto para reversar los movimientos de la cita ${appointmentId}`);
      return;
    }

    for (const movement of movements) {
      // Verificar si ya tiene una reversa activa
      const existingReversal = await CashMovement.findOne({
        where: {
          reversesMovementId: movement.id,
          isReversal: true
        }
      });

      if (existingReversal) {
        console.log(`[Cash Register] El movimiento ${movement.id} ya fue reversado anteriormente.`);
        continue;
      }

      // Crear el movimiento de reversa (tipo opuesto)
      const reversalType = movement.type === 'income' ? 'expense' : 'income';
      const description = movement.type === 'income' 
        ? `REVERSA INGRESO: Cita #${appointmentId.slice(0, 8)}`
        : `REVERSA INSUMOS: Cita #${appointmentId.slice(0, 8)}`;

      await CashMovement.create({
        businessId: movement.businessId,
        shiftId: activeShift.id,
        type: reversalType,
        amount: movement.amount,
        paymentMethod: movement.paymentMethod,
        description: `${description} - Cambio de estado / Anulación`,
        notes: `Reversa automática por cambio de estado. ID Original: ${movement.id}`,
        isReversal: true,
        reversesMovementId: movement.id,
        appointmentId: appointmentId,
        createdBy: userId
      });
    }

    console.log(`[Cash Register] ✅ Reversas exitosas para cita ${appointmentId} en el turno ${activeShift.id}`);
  } catch (error) {
    console.error('[Cash Register] Error reversando movimiento:', error.message);
  }
}

module.exports = {
  registerCashMovementForAppointment,
  reverseCashMovementForAppointment
};
