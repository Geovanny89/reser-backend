/**
 * Procesamiento de respuestas de clientes por WhatsApp
 * Archivo: evolution/messageHandler.js
 * 
 * Maneja:
 * - Confirmación de citas (sí/no)
 * - Cancelación de citas
 * - Calificación 1-5
 * - Agradecimientos
 */

const { Appointment, Business, IncomingMessage } = require('../../models');
const { sendMessageDirect } = require('./instanceManager');
const { getRandomConfirmationTemplate, getRandomCancelTemplate, getRandomRatingThanksTemplate } = require('./templates');
const { emitAppointmentUpdate } = require('../socketService');

/**
 * Limpia un número de teléfono
 */
function cleanPhoneNumber(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

/**
 * Extrae el número de teléfono de un mensaje de Evolution API
 */
function extractPhoneNumber(msg, from) {
  // Evolution API usa formato: 573001234567@s.whatsapp.net o 150131068424290@lid (lista de difusión)
  let cleanFrom = from.split('@')[0];

  // Si es una lista de difusión (@lid), intentar obtener el número real del participant o sender
  if (from.includes('@lid')) {
    const participant = msg?.participant || msg?.data?.participant || msg?.key?.participant || msg?.data?.sender || msg?.sender;
    if (participant) {
      cleanFrom = participant.split('@')[0];
      console.log(`[Evolution Message] 📋 Mensaje desde lista, usando participant/sender: ${cleanFrom}`);
    }
  }

  const cleanIncomingPhone = cleanPhoneNumber(cleanFrom);

  if (!cleanIncomingPhone || cleanIncomingPhone.length < 10) {
    console.log(`[Evolution Message] ⚠️ Número inválido: ${from} -> ${cleanFrom}`);
    return null;
  }

  return { cleanIncomingPhone, originalFrom: from };
}

/**
 * Guarda mensaje entrante en BD
 */
async function saveIncomingMessage(businessId, phone, text, msg, processed = false) {
  try {
    const saved = await IncomingMessage.create({
      businessId,
      phone,
      message: text,
      whatsappMessageId: msg.id?._serialized || msg.id,
      status: processed ? 'processed' : 'pending',
      receivedAt: new Date()
    });
    return saved;
  } catch (e) {
    console.error('[Evolution Message] ❌ Error guardando mensaje:', e.message);
    return null;
  }
}

/**
 * Actualiza estado de mensaje entrante
 */
async function updateIncomingMessageStatus(messageId, status) {
  try {
    await IncomingMessage.update(
      { status, processedAt: new Date() },
      { where: { id: messageId } }
    );
  } catch (e) {
    console.error('[Evolution Message] ❌ Error actualizando mensaje:', e.message);
  }
}

/**
 * Obtiene IDs de negocios vinculados
 */
async function getLinkedBusinessIds(businessId) {
  try {
    const business = await Business.findByPk(businessId);
    if (!business) return [businessId];

    const linkedIds = [businessId];
    if (business.parentBusinessId) {
      linkedIds.push(business.parentBusinessId);
    }

    // Buscar sucursales hijas
    const children = await Business.findAll({
      where: { parentBusinessId: businessId },
      attributes: ['id']
    });
    children.forEach(child => linkedIds.push(child.id));

    return linkedIds;
  } catch (e) {
    console.error('[Evolution Message] ❌ Error obteniendo negocios vinculados:', e.message);
    return [businessId];
  }
}

/**
 * Busca cita por código de referencia
 */
async function findAppointmentByReference(text, businessIds) {
  try {
    const refCode = text.trim().toUpperCase();
    const appt = await Appointment.findOne({
      where: {
        referenceCode: refCode,
        businessId: businessIds
      },
      include: [
        { model: Business, as: 'Business' },
        { model: require('../../models').Employee, as: 'Employee' }
      ]
    });
    return appt;
  } catch (e) {
    console.error('[Evolution Message] ❌ Error buscando por referencia:', e.message);
    return null;
  }
}

/**
 * Busca citas por teléfono
 */
async function findAppointmentsForPhone(businessIds, phone, isFromList = false) {
  try {
    let whereClause = {
      businessId: businessIds
    };

    // Solo filtrar por teléfono si NO es una lista de difusión
    if (!isFromList) {
      const basePhone = phone.length > 10 ? phone.slice(-10) : phone;
      whereClause.clientPhone = { [require('sequelize').Op.like]: `%${basePhone}%` };
    }

    const appointments = await Appointment.findAll({
      where: whereClause,
      include: [
        { model: Business, as: 'Business' },
        { model: require('../../models').Employee, as: 'Employee' }
      ],
      order: [['startTime', 'DESC']]
    });

    const activeAppts = appointments.filter(a => ['pending', 'confirmed', 'attention'].includes(a.status));
    const doneAppts = appointments.filter(a => a.status === 'done' && a.ratingSent && !a.rating && a.messageFlowStatus !== 'rated');

    return { activeAppts, doneAppts, allAppointments: appointments };
  } catch (e) {
    console.error('[Evolution Message] ❌ Error buscando citas:', e.message);
    return { activeAppts: [], doneAppts: [], allAppointments: [] };
  }
}

/**
 * Filtra citas por teléfono
 */
function filterAppointmentsByPhone(appointments, cleanPhone, from) {
  console.log(`[Evolution Message] 🔍 Filtrando ${appointments.length} citas por teléfono: ${cleanPhone}`);

  return appointments.filter(appt => {
    const dbPhone = cleanPhoneNumber(appt.clientPhone);
    console.log(`[Evolution Message] 🔍 Comparando: DB="${dbPhone}" vs Incoming="${cleanPhone}"`);

    // Coincidencia exacta
    if (dbPhone === cleanPhone) {
      console.log(`[Evolution Message] ✅ Coincidencia exacta: ${dbPhone}`);
      return true;
    }

    // Coincidencia parcial (últimos 10 dígitos)
    if (dbPhone.slice(-10) === cleanPhone.slice(-10)) {
      console.log(`[Evolution Message] ✅ Coincidencia últimos 10 dígitos: ${dbPhone.slice(-10)}`);
      return true;
    }

    // Coincidencia en el from
    if (from.includes(dbPhone.slice(-10))) {
      console.log(`[Evolution Message] ✅ Coincidencia en from: ${dbPhone.slice(-10)}`);
      return true;
    }

    // Si el número tiene 12 dígitos (con prefijo 57), intentar sin prefijo
    if (dbPhone.length === 12 && dbPhone.startsWith('57')) {
      const dbPhoneWithoutPrefix = dbPhone.slice(2);
      if (dbPhoneWithoutPrefix === cleanPhone || cleanPhone === dbPhoneWithoutPrefix.slice(-10)) {
        console.log(`[Evolution Message] ✅ Coincidencia sin prefijo 57: ${dbPhoneWithoutPrefix}`);
        return true;
      }
    }

    return false;
  });
}

/**
 * Determina la acción basada en el texto
 */
function determineAction(matchedAppointments, text) {
  const cleanText = text.trim().toLowerCase();

  // Verificar si es un número (calificación)
  const number = parseInt(cleanText);
  const isRatingNumber = !isNaN(number) && number >= 1 && number <= 5;

  // Si hay múltiples citas, priorizar según el tipo de respuesta:
  // - Si es un número (calificación), priorizar awaiting_rating primero
  // - Si no, priorizar awaiting_confirmation, luego pending/attention, luego awaiting_rating
  let matchedAppt = matchedAppointments[0];

  if (matchedAppointments.length > 1) {
    if (isRatingNumber) {
      // PRIORIDAD 1 para calificaciones: citas en awaiting_rating
      const ratingAppt = matchedAppointments.find(a =>
        a.messageFlowStatus === 'awaiting_rating' ||
        (a.status === 'done' && !a.rating)
      );
      if (ratingAppt) {
        matchedAppt = ratingAppt;
        console.log(`[Evolution Message] 🎯 Usando cita awaiting_rating para calificación`);
      } else {
        // Si no hay awaiting_rating, buscar awaiting_confirmation
        const awaitingConfirmAppt = matchedAppointments.find(a =>
          a.messageFlowStatus === 'awaiting_confirmation' &&
          ['pending', 'attention'].includes(a.status)
        );
        if (awaitingConfirmAppt) {
          matchedAppt = awaitingConfirmAppt;
          console.log(`[Evolution Message] 🎯 Usando cita awaiting_confirmation (fallback)`);
        }
      }
    } else {
      // PRIORIDAD normal: awaiting_confirmation -> pending/attention -> awaiting_rating
      const awaitingConfirmAppt = matchedAppointments.find(a =>
        a.messageFlowStatus === 'awaiting_confirmation' &&
        ['pending', 'attention'].includes(a.status)
      );
      if (awaitingConfirmAppt) {
        matchedAppt = awaitingConfirmAppt;
        console.log(`[Evolution Message] 🎯 Usando cita awaiting_confirmation: status=${awaitingConfirmAppt.status}`);
      } else {
        const pendingAppt = matchedAppointments.find(a =>
          ['pending', 'attention'].includes(a.status)
        );
        if (pendingAppt) {
          matchedAppt = pendingAppt;
          console.log(`[Evolution Message] 🎯 Usando cita pendiente: status=${pendingAppt.status}`);
        } else {
          const ratingAppt = matchedAppointments.find(a => a.messageFlowStatus === 'awaiting_rating');
          if (ratingAppt) {
            matchedAppt = ratingAppt;
            console.log(`[Evolution Message] 🎯 Usando cita awaiting_rating`);
          }
        }
      }
    }
  }

  return { matchedAppt, isRatingNumber, number };
}

/**
 * Verifica si el texto es una confirmación
 */
function isConfirmation(text) {
  const confirmations = ['1', 'si', 'sí', 'yes', 'y', 'confirmar', 'confirmo', 'ok', 'vale', 'aceptar', 'confirm'];
  return confirmations.includes(text.toLowerCase().trim());
}

/**
 * Verifica si el texto es una cancelación
 */
function isCancellation(text) {
  const cleanText = text.toLowerCase().trim();
  const cancellations = ['2', 'no', 'cancelar', 'cancelo', 'cancel', 'no puedo', 'no asistiré', 'no asistire', 'no asistir'];

  // Verificar coincidencia exacta primero (para respuestas simples como "no", "2")
  if (cancellations.includes(cleanText)) {
    return true;
  }

  // Para frases más largas, verificar que el texto SEA exactamente una de las opciones
  // pero permitir variaciones menores en espacios
  const normalizedText = cleanText.replace(/\s+/g, ' ');
  const normalizedCancellations = cancellations.map(c => c.replace(/\s+/g, ' '));

  return normalizedCancellations.includes(normalizedText);
}

/**
 * Extrae calificación del texto
 */
function extractRating(text) {
  const cleanText = text.trim();
  const number = parseInt(cleanText);
  if (!isNaN(number) && number >= 1 && number <= 5) {
    return number;
  }
  return null;
}

/**
 * Maneja confirmación de cita
 */
async function handleConfirmation(appt, msg) {
  try {
    await appt.update({
      status: 'confirmed',
      confirmed: true,
      confirmedAt: new Date(),
      messageFlowStatus: 'confirmed'
    });

    // Emitir actualización en tiempo real
    emitAppointmentUpdate(appt.toJSON(), 'updated');

    const template = getRandomConfirmationTemplate();
    // Usar el número del cliente de la cita si el mensaje viene de una lista de difusión
    const phoneToSend = msg.from.includes('@lid') ? appt.clientPhone : msg.from;
    await sendMessageDirect(appt.businessId, phoneToSend, template);

    console.log(`[Evolution Message] ✅ Cita ${appt.id} confirmada por ${appt.clientName}`);
    return true;
  } catch (e) {
    console.error('[Evolution Message] ❌ Error confirmando cita:', e.message);
    return false;
  }
}

/**
 * Maneja cancelación de cita
 */
async function handleCancellation(appt, msg) {
  try {
    await appt.update({
      status: 'cancelled',
      cancelledAt: new Date(),
      messageFlowStatus: 'cancelled'
    });

    // Emitir actualización en tiempo real
    emitAppointmentUpdate(appt.toJSON(), 'updated');

    const template = getRandomCancelTemplate();
    // Usar el número del cliente de la cita si el mensaje viene de una lista de difusión
    const phoneToSend = msg.from.includes('@lid') ? appt.clientPhone : msg.from;
    await sendMessageDirect(appt.businessId, phoneToSend, template);

    console.log(`[Evolution Message] ✅ Cita ${appt.id} cancelada por ${appt.clientName}`);
    return true;
  } catch (e) {
    console.error('[Evolution Message] ❌ Error cancelando cita:', e.message);
    return false;
  }
}

/**
 * Maneja calificación
 */
async function handleRating(appt, rating, phone, msg) {
  try {
    await appt.update({
      rating,
      ratingSubmittedAt: new Date(),
      messageFlowStatus: 'rated'
    });

    // Emitir actualización en tiempo real
    emitAppointmentUpdate(appt.toJSON(), 'updated');

    const thanksTemplate = getRandomRatingThanksTemplate(rating);
    // Usar el número del cliente de la cita si el mensaje viene de una lista de difusión
    const phoneToSend = msg.from.includes('@lid') ? appt.clientPhone : msg.from;
    await sendMessageDirect(appt.businessId, phoneToSend, thanksTemplate);

    console.log(`[Evolution Message] ✅ Cita ${appt.id} calificada con ${rating}⭐ por ${appt.clientName}`);
    return true;
  } catch (e) {
    console.error('[Evolution Message] ❌ Error calificando cita:', e.message);
    return false;
  }
}

/**
 * Verifica si el mensaje es una respuesta válida (confirmación, cancelación, calificación o código de referencia)
 */
function isValidResponse(text) {
  const cleanText = text.trim().toLowerCase();

  // Verificar si es confirmación
  const confirmations = ['1', 'si', 'sí', 'yes', 'y', 'confirmar', 'confirmo', 'ok', 'vale', 'aceptar', 'confirm'];
  if (confirmations.includes(cleanText)) return true;

  // Verificar si es cancelación
  const cancellations = ['2', 'no', 'cancelar', 'cancelo', 'cancel', 'no puedo', 'no asistiré', 'no asistire', 'no asistir'];
  if (cancellations.includes(cleanText)) return true;

  // Verificar si es calificación (1-5)
  const number = parseInt(cleanText);
  if (!isNaN(number) && number >= 1 && number <= 5) return true;

  // Verificar si parece un código de referencia (formato típico: ABC123 o similar)
  const refCodePattern = /^[A-Z0-9]{3,10}$/i;
  if (refCodePattern.test(text.trim())) return true;

  return false;
}

/**
 * Maneja la respuesta del cliente
 */
async function handleClientResponse(businessId, client, msg) {
  const text = (msg.body || '').trim().toLowerCase().replace(/\*/g, '');
  const originalText = (msg.body || '').trim();
  const from = msg.from;
  const pushName = msg.pushName || msg.data?.pushName || '';

  // FILTRO TEMPRANO: Solo procesar mensajes que sean respuestas válidas
  if (!isValidResponse(originalText)) {
    console.log(`[Evolution Message] 🔕 Mensaje ignorado (no es respuesta válida): "${originalText}"`);
    return;
  }

  // Extraer número de teléfono
  const phoneData = await extractPhoneNumber(msg, from);
  if (!phoneData) return;

  const { cleanIncomingPhone } = phoneData;
  console.log(`[Evolution Message] 📥 Mensaje de: ${from} | Texto: "${text}" | Tel: ${cleanIncomingPhone} | Nombre: ${pushName} | BIZ: ${businessId}`);

  // Guardar mensaje en BD
  const savedMessage = await saveIncomingMessage(businessId, cleanIncomingPhone, text, msg, false);

  // Obtener IDs de negocios vinculados
  const businessIds = await getLinkedBusinessIds(businessId);

  // 1. Buscar por código de referencia primero
  const apptByRef = await findAppointmentByReference(text, businessIds);
  if (apptByRef) {
    const processed = await processAppointmentResponse(apptByRef, text, msg, cleanIncomingPhone);
    if (processed && savedMessage) {
      await updateIncomingMessageStatus(savedMessage.id, 'processed');
    }
    return;
  }

  // 2. Buscar citas por teléfono (o todas si es lista de difusión)
  const isFromList = from.includes('@g.us') || from.includes('@broadcast');
  const { activeAppts, doneAppts, allAppointments } = await findAppointmentsForPhone(businessIds, cleanIncomingPhone, isFromList);

  console.log(`[Evolution Message] 🔍 Buscando en ${allAppointments.length} citas (${activeAppts.length} activas, ${doneAppts.length} con solicitud enviada)`);

  // Mostrar todas las citas activas esperando confirmación
  const awaitingConfirm = allAppointments.filter(a =>
    a.messageFlowStatus === 'awaiting_confirmation' &&
    ['pending', 'attention'].includes(a.status)
  );
  if (awaitingConfirm.length > 0) {
    console.log(`[Evolution Message] 📋 Citas esperando confirmación:`);
    awaitingConfirm.forEach((appt, idx) => {
      console.log(`[Evolution Message]   - Cita ${idx + 1}: ID=${appt.id.slice(0, 8)}, nombre="${appt.clientName}", phone="${appt.clientPhone}", startTime=${appt.startTime}`);
    });
  }

  // Filtrar por teléfono (si no es lista de difusión)
  let matchedAppointments = isFromList ? allAppointments : filterAppointmentsByPhone(allAppointments, cleanIncomingPhone, from);

  // 3. Si es lista de difusión, filtrar por nombre PRIMERO (el participant no es confiable en listas de difusión)
  if (isFromList && pushName) {
    console.log(`[Evolution Message] 🔍 Lista de difusión detectada, filtrando por nombre: ${pushName}`);
    const cleanPushName = pushName.toLowerCase().replace(/[^a-z0-9]/g, '');

    matchedAppointments = matchedAppointments.filter(appt => {
      const clientName = (appt.clientName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      // Coincidencia parcial: si el nombre del cliente contiene parte del pushName o viceversa
      const match = clientName.includes(cleanPushName) || cleanPushName.includes(clientName) ||
        clientName.length > 0 && cleanPushName.length > 0 &&
        (clientName.slice(0, 5) === cleanPushName.slice(0, 5) ||
          clientName.slice(-5) === cleanPushName.slice(-5));

      if (match) {
        console.log(`[Evolution Message] ✅ Coincidencia por nombre: "${clientName}" ≈ "${cleanPushName}"`);
      }
      return match;
    });

    if (matchedAppointments.length > 0) {
      console.log(`[Evolution Message] 📍 Encontradas ${matchedAppointments.length} citas por nombre: ${pushName}`);

      // Verificar si alguna de las citas encontradas está esperando confirmación
      const awaitingConfirmByName = matchedAppointments.find(a =>
        a.messageFlowStatus === 'awaiting_confirmation' &&
        ['pending', 'attention'].includes(a.status)
      );

      if (awaitingConfirmByName) {
        matchedAppointments = [awaitingConfirmByName];
        console.log(`[Evolution Message] 🎯 Usando cita awaiting_confirmation encontrada por nombre: status=${awaitingConfirmByName.status}`);
      } else {
        // Si ninguna de las citas por nombre está esperando confirmación, NO usar citas awaiting_confirmation
        // para evitar cancelaciones incorrectas - solo usar citas activas con coincidencia de nombre
        console.log(`[Evolution Message] ⚠️ Citas por nombre no están esperando confirmación - usando citas activas con coincidencia de nombre`);
        const activeApptsByName = matchedAppointments.filter(a => ['pending', 'confirmed', 'attention'].includes(a.status));
        if (activeApptsByName.length > 0) {
          matchedAppointments = [activeApptsByName[0]];
          console.log(`[Evolution Message] 🎯 Usando cita activa por coincidencia de nombre: status=${activeApptsByName[0].status}`);
        } else {
          matchedAppointments = [];
          console.log(`[Evolution Message] ⚠️ Sin citas activas con coincidencia de nombre, ignorando mensaje`);
        }
      }
    } else {
      // Si no hay coincidencia por nombre en lista de difusión, NO usar citas awaiting_confirmation
      // para evitar cancelaciones incorrectas por mensajes de personas no identificadas
      console.log(`[Evolution Message] ⚠️ Sin coincidencia por nombre en lista de difusión - ignorando para evitar cancelaciones incorrectas`);
      // Solo usar citas activas si el teléfono coincide directamente (no en lista de difusión)
      if (!isFromList && activeAppts.length > 0) {
        matchedAppointments = [activeAppts[0]];
        console.log(`[Evolution Message] 🎯 Usando cita activa por coincidencia de teléfono directo: status=${activeAppts[0].status}`);
      } else {
        matchedAppointments = [];
        console.log(`[Evolution Message] ⚠️ Sin coincidencia válida, ignorando mensaje`);
      }
    }
  }

  if (matchedAppointments.length === 0) {
    console.log(`[Evolution Message] 🔍 Sin coincidencias para tel: ${cleanIncomingPhone}, nombre: ${pushName}`);
    return;
  }

  console.log(`[Evolution Message] 📍 Encontradas ${matchedAppointments.length} citas para tel:${cleanIncomingPhone}`);

  // Mostrar detalles de las citas encontradas
  matchedAppointments.forEach((appt, idx) => {
    console.log(`[Evolution Message] 📋 Cita ${idx + 1}: ID=${appt.id.slice(0, 8)}, status=${appt.status}, confirmed=${appt.confirmed}, messageFlowStatus=${appt.messageFlowStatus}, startTime=${appt.startTime}`);
  });

  // Ignorar mensajes de bots o respuestas automáticas
  const botPatterns = [
    'gracias por comunicarte',
    'haznos saber cómo podemos ayudarte',
    'welcome',
    'thank you for contacting',
    'how can we help',
    'mensaje automático',
    'automatic message'
  ];

  const isBotMessage = botPatterns.some(pattern =>
    text.toLowerCase().includes(pattern.toLowerCase())
  );

  if (isBotMessage) {
    console.log(`[Evolution Message] 🤖 Mensaje de bot detectado, ignorando: "${text}"`);
    return;
  }

  // Determinar acción
  const { matchedAppt, isRatingNumber, number } = determineAction(matchedAppointments, text);

  // Verificar si puede confirmar/cancelar
  const canConfirmCancel = ['pending', 'confirmed', 'attention'].includes(matchedAppt.status) &&
    (!matchedAppt.confirmed || matchedAppt.messageFlowStatus === 'awaiting_confirmation');

  console.log(`[Evolution Message] 🔍 Estado cita: status=${matchedAppt.status}, confirmed=${matchedAppt.confirmed}, messageFlowStatus=${matchedAppt.messageFlowStatus}`);
  console.log(`[Evolution Message] 🔍 canConfirmCancel=${canConfirmCancel}, isRatingNumber=${isRatingNumber}`);

  let wasProcessed = false;

  // Prioridad: si está esperando calificación, procesar calificación primero
  const canRate = (matchedAppt.messageFlowStatus === 'awaiting_rating') ||
    (matchedAppt.status === 'done' && !matchedAppt.rating);

  if (canRate && isRatingNumber) {
    await handleRating(matchedAppt, number, cleanIncomingPhone, msg);
    wasProcessed = true;
  }

  // Si no se procesó como calificación, procesar confirmación/cancelación
  if (!wasProcessed && canConfirmCancel) {
    if (isConfirmation(text)) {
      await handleConfirmation(matchedAppt, msg);
      wasProcessed = true;
    } else if (isCancellation(text)) {
      await handleCancellation(matchedAppt, msg);
      wasProcessed = true;
    }
  }

  // Actualizar mensaje a 'processed' si se procesó exitosamente
  if (wasProcessed && savedMessage) {
    await updateIncomingMessageStatus(savedMessage.id, 'processed');
  }
}

/**
 * Procesa respuesta para una cita específica
 */
async function processAppointmentResponse(appt, text, msg, phone) {
  const canConfirmCancel = ['pending', 'confirmed', 'attention'].includes(appt.status);

  if (canConfirmCancel) {
    if (isConfirmation(text)) {
      return await handleConfirmation(appt, msg);
    } else if (isCancellation(text)) {
      // Verificación de seguridad adicional: el teléfono debe coincidir antes de cancelar
      const dbPhone = cleanPhoneNumber(appt.clientPhone);
      const cleanPhone = cleanPhoneNumber(phone);
      const phoneMatch = dbPhone === cleanPhone ||
        dbPhone.slice(-10) === cleanPhone.slice(-10) ||
        cleanPhone.includes(dbPhone.slice(-10));

      if (!phoneMatch) {
        console.log(`[Evolution Message] ⚠️ CANCELACIÓN BLOQUEADA: Teléfono no coincide - DB="${dbPhone}" vs Incoming="${cleanPhone}"`);
        return false;
      }

      return await handleCancellation(appt, msg);
    }
  }

  const canRate = (appt.messageFlowStatus === 'awaiting_rating') ||
    (appt.status === 'done' && !appt.rating);

  if (canRate) {
    const rating = extractRating(text);
    if (rating) {
      return await handleRating(appt, rating, phone, msg);
    }
  }

  return false;
}

module.exports = {
  handleClientResponse,
  processAppointmentResponse
};
