const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define('Appointment', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    businessId:  { type: DataTypes.UUID, allowNull: false },
    serviceId:   { type: DataTypes.UUID, allowNull: false },
    employeeId:  { type: DataTypes.UUID, allowNull: false },
    clientId:    { type: DataTypes.UUID },
    clientName:  { type: DataTypes.STRING },
    clientPhone: { type: DataTypes.STRING },
    clientEmail: { type: DataTypes.STRING, comment: 'Email del cliente no registrado para notificaciones' },
    startTime:   { type: DataTypes.DATE, allowNull: false },
    endTime:     { type: DataTypes.DATE, allowNull: false },
    status:      { type: DataTypes.ENUM('pending', 'confirmed', 'attention', 'done', 'cancelled'), defaultValue: 'pending' },
    notes:       { type: DataTypes.TEXT },
    reminderSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió el recordatorio de 1 hora' },
    reminder30mSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió el recordatorio de 30 minutos' },
    pendingAlertSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió alerta de 15 min de cita pendiente' },
    pendingAlert30mSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió alerta de 30 min de cita pendiente' },
    pendingAlert60mSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió alerta de 1 hora de cita pendiente' },
    reminder12hSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió recordatorio de 12 horas' },
    reminder24hSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió recordatorio de 24 horas' },
    reminder2hSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió recordatorio de 2 horas' },
    confirmed: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si el cliente confirmó que asistirá' },
    confirmedAt: { type: DataTypes.DATE, comment: 'Fecha cuando el cliente confirmó' },
    rating: { type: DataTypes.INTEGER, validate: { min: 1, max: 5 }, comment: 'Calificación del cliente (1-5)' },
    ratingComment: { type: DataTypes.TEXT, comment: 'Comentario opcional de la calificación' },
    ratingSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió solicitud de calificación' },
    ratingSentAt: { type: DataTypes.DATE, comment: 'Fecha cuando se envió la solicitud de calificación' },
    referenceMessageSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió mensaje de referencia' },
    thankYouMessageSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió mensaje de agradecimiento por calificación' },
    thankYouMessageSentAt: { type: DataTypes.DATE, comment: 'Fecha cuando se envió mensaje de agradecimiento' },
    additionalAmount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0, comment: 'Monto adicional al servicio base' },
    additionalNote: { type: DataTypes.STRING, comment: 'Descripción del cargo adicional (ej: figura complicada)' },
    basePrice: { type: DataTypes.DECIMAL(10, 2), comment: 'Precio base del servicio al momento de agendar' },
    discountApplied: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0, comment: 'Descuento total aplicado' },
    finalPrice: { type: DataTypes.DECIMAL(10, 2), comment: 'Precio final calculado (base - descuento + adicional)' },
    promotionId: { type: DataTypes.UUID, comment: 'ID de la promoción aplicada' },
    paymentMethod: { type: DataTypes.ENUM('cash', 'transfer'), comment: 'Método de pago: efectivo o transferencia' },
    whatsappReminderSent: { type: DataTypes.BOOLEAN, defaultValue: false, comment: 'Indica si ya se envió el recordatorio por WhatsApp' },
    extendedDuration: { type: DataTypes.INTEGER, defaultValue: 0, comment: 'Minutos adicionales extendidos durante la cita' },
    referenceCode: { type: DataTypes.STRING(8), unique: true, comment: 'Código único de 6 caracteres para referencia en WhatsApp (ej: ABC123)' },

    // === Campo para flujo de mensajes automáticos (independiente del status principal) ===
    messageFlowStatus: {
      type: DataTypes.STRING(30),
      defaultValue: 'not_started',
      comment: 'Estado del flujo: not_started, awaiting_confirmation, awaiting_rating, completed'
    },

    // === Campos para seguimiento de Técnicos a Domicilio ===
    technicianStatus: { 
      type: DataTypes.ENUM('not_started', 'on_the_way', 'arrived', 'in_progress'), 
      defaultValue: 'not_started',
      comment: 'Estado del técnico: not_started, on_the_way, arrived, in_progress'
    },
    travelStartTime: { type: DataTypes.DATE, comment: 'Hora cuando el técnico inició el desplazamiento' },
    arrivalTime: { type: DataTypes.DATE, comment: 'Hora cuando el técnico llegó al destino' },
    serviceStartTime: { type: DataTypes.DATE, comment: 'Hora cuando inició el servicio técnico' },
    workReport: { type: DataTypes.JSON, comment: 'Reporte del trabajo: diagnosis, solution, recommendations, partsUsed: [{itemId, name, quantity, unit}]' },
  });
};
