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
    
    descriptionText += ` - ${appointment.clientName}`;

    await CashMovement.create({
      businessId: appointment.businessId,
      shiftId: activeShift.id,
      appointmentId: appointment.id,
      type: 'income',
      amount: amountToRecord,
      paymentMethod: appointment.paymentMethod,
      description: descriptionText,
      createdBy: userId
    });

    console.log(`[Cash Register] Movimiento registrado para cita ${appointment.id}: $${amountToRecord}`);
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
    const movement = await CashMovement.findOne({
      where: {
        appointmentId,
        isReversal: false
      }
    });

    if (!movement) return;

    // Verificar si ya tiene una reversa activa
    const existingReversal = await CashMovement.findOne({
      where: {
        reversesMovementId: movement.id,
        isReversal: true
      }
    });

    if (existingReversal) {
      console.log(`[Cash Register] El movimiento para la cita ${appointmentId} ya fue reversado anteriormente.`);
      return;
    }

    // Buscar turno de caja activo para el negocio
    const activeShift = await CashRegisterShift.findOne({
      where: {
        businessId: movement.businessId,
        status: 'open'
      }
    });

    if (!activeShift) {
      console.log(`[Cash Register] No hay turno abierto para reversar el movimiento de la cita ${appointmentId}`);
      return;
    }

    // Crear el movimiento de reversa (tipo opuesto)
    const reversalType = movement.type === 'income' ? 'expense' : 'income';

    await CashMovement.create({
      businessId: movement.businessId,
      shiftId: activeShift.id, // Se registra en el turno actual
      type: reversalType,
      amount: movement.amount,
      paymentMethod: movement.paymentMethod,
      description: `REVERSA: Cita #${appointmentId.slice(0, 8)} - Cambio de estado / Anulación`,
      notes: `Reversa automática por cambio de estado desde el sistema. ID Original: ${movement.id}`,
      isReversal: true,
      reversesMovementId: movement.id,
      appointmentId: appointmentId,
      createdBy: userId
    });

    console.log(`[Cash Register] ✅ Reversa exitosa para cita ${appointmentId} en el turno ${activeShift.id}`);
  } catch (error) {
    console.error('[Cash Register] Error reversando movimiento:', error.message);
  }
}

module.exports = {
  registerCashMovementForAppointment,
  reverseCashMovementForAppointment
};
