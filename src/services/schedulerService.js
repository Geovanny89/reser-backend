const { ScheduledMessage, Business, WhatsAppSession, IncomingMessage, Appointment, sequelize } = require('../models');
const { Op } = require('sequelize');
const whatsappService = require('./evolutionService');

/**
 * Servicio de programación de mensajes de WhatsApp
 * Procesa mensajes en cola de forma eficiente para múltiples negocios
 * con conexión/desconexión bajo demanda para optimizar RAM
 */

// Control de procesamiento
let isProcessing = false;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 60000; // 1 minuto entre reintentos

/**
 * Verifica si es horario laboral en Colombia (7:00 AM - 11:00 PM)
 * WhatsApp puede bloquear números que envían fuera de horarios normales
 * Colombia es UTC-5 (todo el año, no tiene horario de verano)
 * NOTA: Horario extendido hasta las 11 PM para pruebas
 */
function isBusinessHours() {
  const now = new Date();
  const colombiaOffset = -5 * 60 * 60 * 1000;
  const colombiaTime = new Date(now.getTime() + colombiaOffset);
  const hour = colombiaTime.getUTCHours();
  return hour >= 7 && hour < 23; // 7:00 AM - 11:00 PM Colombia (extendido para pruebas)
}

/**
 * Ajusta una fecha programada para que caiga dentro del horario laboral
 * Horario laboral: 7:00 AM - 11:00 PM Colombia (extendido para pruebas)
 * Si es antes de las 7:00 AM, programa a las 7:00 AM del mismo día
 * Si es después de las 11:00 PM, programa a las 7:00 AM del día siguiente
 */
function adjustToBusinessHours(date) {
  const colombiaOffset = -5 * 60 * 60 * 1000;

  // Calcular hora en Colombia (usando UTC hours del tiempo ajustado)
  const colombiaTime = new Date(date.getTime() + colombiaOffset);
  const hourInColombia = colombiaTime.getUTCHours();

  // Crear copia para no modificar la original
  const adjusted = new Date(date);

  // Horario laboral Colombia: 7:00 AM (07:00) a 11:00 PM (23:00) - extendido para pruebas
  // En UTC: 12:00 a 04:00 del día siguiente

  if (hourInColombia < 7) {
    // Antes de las 7:00 AM Colombia, ajustar a 7:00 AM de hoy
    // 7:00 AM Colombia = 12:00 UTC
    const targetUTC = new Date(colombiaTime);
    targetUTC.setUTCHours(12, 0, 0, 0);

    adjusted.setTime(targetUTC.getTime() - colombiaOffset);
    console.log(`[Scheduler] ⏰ Hora ajustada de ${hourInColombia}:00 a 7:00 AM (inicio horario laboral)`);
  } else if (hourInColombia >= 23) {
    // Después de las 11:00 PM Colombia, ajustar a 7:00 AM del día siguiente
    // 7:00 AM Colombia del día siguiente = 12:00 UTC del día siguiente
    const targetUTC = new Date(colombiaTime);
    targetUTC.setUTCDate(targetUTC.getUTCDate() + 1);
    targetUTC.setUTCHours(12, 0, 0, 0);

    adjusted.setTime(targetUTC.getTime() - colombiaOffset);
    console.log(`[Scheduler] ⏰ Hora ajustada de ${hourInColombia}:00 a 7:00 AM del día siguiente`);
  }
  // Si está entre 7:00 AM y 11:00 PM Colombia, no ajustar

  return adjusted;
}

/**
 * Obtiene mensajes pendientes agrupados por negocio
 * Optimizado para procesar en lotes eficientes
 */
async function getPendingMessagesGrouped() {
  const now = new Date();

  console.log(`[Scheduler] 🔍 Buscando mensajes pendientes...`);
  console.log(`[Scheduler]    - Ahora (UTC): ${now.toISOString()}`);
  console.log(`[Scheduler]    - Ahora (COL): ${new Date(now.getTime() - 5*60*60*1000).toISOString().replace('Z', '-05:00')}`);

  // Buscar mensajes pending que deberían enviarse ya
  const messages = await ScheduledMessage.findAll({
    where: {
      status: 'pending',
      scheduledAt: { [Op.lte]: now },
      retryCount: { [Op.lt]: MAX_RETRIES }
    },
    order: [['scheduledAt', 'ASC'], ['businessId', 'ASC']],
    limit: 100 // Procesar máximo 100 mensajes por ciclo
  });

  console.log(`[Scheduler] 🔍 Mensajes encontrados: ${messages.length}`);

  if (messages.length > 0) {
    messages.forEach(msg => {
      console.log(`[Scheduler]    - ID: ${msg.id}, Tipo: ${msg.type}, scheduledAt: ${msg.scheduledAt}, Phone: ${msg.phone}`);
    });
  }

  // Agrupar por negocio
  const grouped = {};
  for (const msg of messages) {
    if (!grouped[msg.businessId]) {
      grouped[msg.businessId] = [];
    }
    grouped[msg.businessId].push(msg);
  }

  return grouped;
}

/**
 * Procesa mensajes de un negocio específico
 * Conecta WhatsApp, envía mensajes, desconecta
 */
async function processBusinessMessages(businessId, messages) {
  console.log(`[Scheduler] 📦 Procesando ${messages.length} mensajes para negocio ${businessId}`);

  // Timeout global para todo el procesamiento de un negocio (6 minutos máximo)
  // Debe ser > 5 minutos de espera cuando hay mensajes que esperan respuesta del cliente
  const BUSINESS_TIMEOUT_MS = 6 * 60 * 1000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout: procesamiento de negocio excedió 6 minutos')), BUSINESS_TIMEOUT_MS)
  );

  try {
    // Correr todo el procesamiento con timeout
    return await Promise.race([processBusinessMessagesInternal(businessId, messages), timeoutPromise]);
  } catch (error) {
    console.error(`[Scheduler] ❌ Timeout o error procesando negocio ${businessId}:`, error.message);

    // Asegurar desconexión en caso de timeout
    try {
      await whatsappService.stopInstance(businessId);
    } catch (e) {}

    // Incrementar retry count de mensajes pendientes
    for (const msg of messages) {
      const newRetryCount = msg.retryCount + 1;
      await msg.update({
        retryCount: newRetryCount,
        errorMessage: error.message,
        status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending'
      });
    }

    return { success: false, reason: error.message, messagesKept: messages.length };
  }
}

/**
 * Procesamiento interno de mensajes de un negocio (sin timeout wrapper)
 */
async function processBusinessMessagesInternal(businessId, messages) {
  try {
    // 1. Verificar que el negocio tiene sesión válida
    if (!whatsappService.hasValidSession(businessId)) {
      console.log(`[Scheduler] ⚠️ Negocio ${businessId} no tiene sesión válida, saltando (mensajes permanecen en pending)...`);
      // NO marcar mensajes como failed - dejarlos en pending para el próximo ciclo
      // cuando el negocio vuelva a conectar WhatsApp
      return { success: false, reason: 'no_session', messagesKept: messages.length };
    }

    // 2. Verificar sesión en BD
    const session = await WhatsAppSession.findOne({
      where: { businessId, status: 'connected' }
    });

    if (!session) {
      console.log(`[Scheduler] ⚠️ Negocio ${businessId} no tiene sesión activa en BD`);
    }

    // 3. Conectar WhatsApp (crear instancia temporal)
    console.log(`[Scheduler] 🔌 Conectando WhatsApp para ${businessId}...`);
    let client;
    try {
      client = await whatsappService.createInstance(businessId);
      console.log(`[Scheduler] ✅ WhatsApp conectado para ${businessId}`);
      
      // Esperar a que WhatsApp se sincronice completamente (5 segundos)
      console.log(`[Scheduler] ⏳ Esperando sincronización de WhatsApp...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log(`[Scheduler] ✅ Sincronización completa`);
      
      // Procesar mensajes entrantes pendientes (respuestas de clientes que llegaron sin conexión)
      await processIncomingMessages(businessId, client);
      
      console.log(`[Scheduler] ✅ Listo para enviar mensajes programados`);
    } catch (connError) {
      console.error(`[Scheduler] ❌ Error conectando WhatsApp para ${businessId}:`, connError.message);
      // Reintentar más tarde
      for (const msg of messages) {
        await msg.update({ 
          retryCount: msg.retryCount + 1,
          errorMessage: connError.message
        });
      }
      return { success: false, reason: 'connection_failed' };
    }

    // 4. Enviar mensajes con delays entre ellos
    let sentCount = 0;
    let failedCount = 0;
    
    // Detectar si hay mensajes que esperan respuesta del cliente
    // 'confirmation' = mensaje con opciones SI/NO, 'rating' = solicitud de calificación 1-5
    const responseTypes = ['rating', 'confirmation'];
    const hasResponseExpected = messages.some(msg => responseTypes.includes(msg.type));

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      try {
        // Delay aleatorio entre mensajes (30-90 segundos) para simular comportamiento humano
        if (i > 0) {
          const delay = 30000 + Math.random() * 60000;
          console.log(`[Scheduler] ⏱️ Esperando ${Math.round(delay/1000)}s antes del siguiente mensaje...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Enviar mensaje directamente (sin pasar por la cola antigua)
        await whatsappService.sendMessageDirect(businessId, msg.phone, msg.message);
        
        // Marcar como enviado
        await msg.update({
          status: 'sent',
          sentAt: new Date()
        });
        
        sentCount++;
        console.log(`[Scheduler] ✅ Mensaje enviado: ${msg.id}`);

      } catch (sendError) {
        console.error(`[Scheduler] ❌ Error enviando mensaje ${msg.id}:`, sendError.message);
        
        // Incrementar contador de reintentos
        const newRetryCount = msg.retryCount + 1;
        await msg.update({
          retryCount: newRetryCount,
          errorMessage: sendError.message,
          status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending'
        });
        
        failedCount++;
      }
    }

    // 5. Desconectar WhatsApp (con tiempo extendido si esperamos respuesta)
    if (hasResponseExpected) {
      console.log(`[Scheduler] ⏳ Mensajes esperan respuesta. Manteniendo conexión 5 minutos...`);
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutos
      console.log(`[Scheduler] ⏳ Tiempo de espera completado, desconectando...`);
    }
    
    console.log(`[Scheduler] 🔌 Desconectando WhatsApp para ${businessId}...`);
    try {
      await whatsappService.stopInstance(businessId);
      console.log(`[Scheduler] ✅ WhatsApp desconectado para ${businessId}`);
    } catch (disconnectError) {
      console.warn(`[Scheduler] ⚠️ Error desconectando (no crítico):`, disconnectError.message);
    }

    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
      total: messages.length
    };

  } catch (error) {
    console.error(`[Scheduler] ❌ Error general procesando negocio ${businessId}:`, error.message);

    // Asegurar desconexión en caso de error
    try {
      await whatsappService.stopInstance(businessId);
    } catch (e) {}

    throw error; // Re-lanzar para que el timeout wrapper lo maneje
  }
}

/**
 * Procesa mensajes entrantes pendientes de clientes
 * Se ejecuta al inicio del scheduler para procesar respuestas que llegaron cuando no había conexión
 */
async function processIncomingMessages(businessId, client) {
  try {
    // Buscar mensajes entrantes pendientes de los últimos 7 días
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const pendingMessages = await IncomingMessage.findAll({
      where: {
        businessId: businessId,
        status: 'pending',
        createdAt: { [Op.gte]: oneWeekAgo }
      },
      order: [['createdAt', 'ASC']], // Procesar del más antiguo al más reciente
      limit: 50 // Máximo 50 por ejecución
    });
    
    if (pendingMessages.length === 0) {
      return { processed: 0, message: 'No hay mensajes entrantes pendientes' };
    }
    
    console.log(`[Scheduler] 📨 Procesando ${pendingMessages.length} mensajes entrantes pendientes...`);
    
    let processed = 0;
    let failed = 0;
    
    for (const msg of pendingMessages) {
      try {
        // Buscar citas para este teléfono
        const phone = msg.phone;
        
        const appointments = await Appointment.findAll({
          where: {
            businessId: businessId,
            clientPhone: { [Op.like]: `%${phone}%` },
            status: { [Op.in]: ['pending', 'confirmed', 'attention', 'done'] }
          },
          order: [['startTime', 'DESC']]
        });
        
        if (appointments.length === 0) {
          // No hay citas para este mensaje, marcar como fallido
          await msg.update({
            status: 'failed',
            errorMessage: 'No se encontraron citas para este número',
            retryCount: msg.retryCount + 1
          });
          console.log(`[Scheduler] ⚠️ Mensaje entrante ${msg.id.slice(0,8)}: Sin citas para tel ${phone}`);
          failed++;
          continue;
        }
        
        // Procesar el mensaje con la primera cita encontrada
        // Usar el servicio de WhatsApp para procesar la respuesta
        const { handleClientResponse } = require('./evolutionService');
        
        // Simular un objeto de mensaje de WhatsApp
        const mockMsg = {
          body: msg.message,
          from: phone,
          id: { _serialized: msg.whatsappMessageId }
        };
        
        // Procesar la respuesta
        await handleClientResponse(businessId, client, mockMsg);
        
        // Marcar como procesado
        await msg.update({
          status: 'processed',
          processedAt: new Date()
        });
        
        processed++;
        console.log(`[Scheduler] ✅ Mensaje entrante ${msg.id.slice(0,8)} procesado para tel ${phone}`);
        
        // Delay entre procesamientos
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (processError) {
        console.error(`[Scheduler] ❌ Error procesando mensaje entrante ${msg.id}:`, processError.message);
        await msg.update({
          status: 'failed',
          errorMessage: processError.message,
          retryCount: msg.retryCount + 1
        });
        failed++;
      }
    }
    
    console.log(`[Scheduler] 📨 Mensajes entrantes: ${processed} procesados, ${failed} fallidos`);
    return { processed, failed };
    
  } catch (error) {
    console.error('[Scheduler] ❌ Error general procesando mensajes entrantes:', error.message);
    return { processed: 0, failed: 0, error: error.message };
  }
}

/**
 * Función principal del scheduler
 * Ejecutar cada 5 minutos via cron
 */
async function runScheduler() {
  // Evitar ejecuciones concurrentes
  if (isProcessing) {
    console.log('[Scheduler] ⏳ Procesamiento anterior en curso, saltando...');
    // Si lleva más de 5 minutos procesando, forzar reset del flag (podría estar colgado)
    const processingTime = Date.now() - (global.schedulerStartTime || 0);
    if (processingTime > 5 * 60 * 1000) {
      console.warn(`[Scheduler] ⚠️ Procesamiento anterior lleva ${Math.round(processingTime/1000)}s, forzando reset...`);
      isProcessing = false;
    } else {
      return { status: 'skipped', reason: 'already_processing', elapsedMs: processingTime };
    }
  }

  // Registrar tiempo de inicio para detectar bloqueos
  global.schedulerStartTime = Date.now();

  // Verificar horario laboral Colombia
  if (!isBusinessHours()) {
    const now = new Date();
    const colombiaOffset = -5 * 60 * 60 * 1000;
    const colombiaTime = new Date(now.getTime() + colombiaOffset);
    const hour = colombiaTime.getUTCHours();
    
    console.log(`[Scheduler] ⏰ Fuera de horario laboral Colombia (${hour}:00). Mensajes quedarán en cola.`);
    return { 
      status: 'paused', 
      reason: 'outside_business_hours',
      colombiaHour: hour 
    };
  }

  isProcessing = true;
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    businesses: []
  };

  try {
    console.log('[Scheduler] 🚀 Iniciando procesamiento de cola...');

    // Obtener mensajes agrupados por negocio
    const groupedMessages = await getPendingMessagesGrouped();
    const businessIds = Object.keys(groupedMessages);

    if (businessIds.length === 0) {
      console.log('[Scheduler] ℹ️ No hay mensajes pendientes');
      isProcessing = false;
      return { status: 'success', processed: 0, message: 'No pending messages' };
    }

    console.log(`[Scheduler] 📊 ${businessIds.length} negocios con mensajes pendientes`);

    // Procesar cada negocio secuencialmente (no en paralelo para controlar RAM)
    for (const businessId of businessIds) {
      const messages = groupedMessages[businessId];
      
      console.log(`[Scheduler] ▶️ Procesando negocio ${businessId} (${messages.length} mensajes)`);
      
      const result = await processBusinessMessages(businessId, messages);
      
      results.businesses.push({
        businessId,
        ...result
      });

      if (result.sent) results.sent += result.sent;
      if (result.failed) results.failed += result.failed;
      results.processed += messages.length;

      // Delay entre negocios para no saturar el servidor
      if (businessIds.indexOf(businessId) < businessIds.length - 1) {
        console.log('[Scheduler] ⏱️ Esperando 10s antes del siguiente negocio...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    console.log(`[Scheduler] ✅ Completado: ${results.sent} enviados, ${results.failed} fallidos`);
    return { status: 'success', ...results };

  } catch (error) {
    console.error('[Scheduler] ❌ Error crítico:', error.message);
    return { status: 'error', error: error.message };
  } finally {
    isProcessing = false;
    global.schedulerStartTime = null; // Limpiar timestamp al terminar
  }
}

/**
 * Programar un mensaje para ser enviado más tarde
 * @param {Object} params - Parámetros del mensaje
 * @param {string} params.businessId - ID del negocio
 * @param {string} params.appointmentId - ID de la cita vinculada
 * @param {string} params.phone - Teléfono destino
 * @param {string} params.message - Contenido del mensaje
 * @param {string} params.type - Tipo de mensaje (reminder, confirmation, rating, custom)
 * @param {Date} params.scheduledAt - Fecha/hora programada
 */
async function scheduleMessage({ businessId, appointmentId, phone, message, type, scheduledAt }) {
  try {
    console.log(`[Scheduler] 📅 Mensaje programado: ${type} para ${phone} a las ${scheduledAt}`);

    // Verificar si ya existe un mensaje del mismo tipo para esta cita (protección contra duplicados)
    if (appointmentId && type) {
      const existingMessage = await ScheduledMessage.findOne({
        where: {
          appointmentId,
          type,
          status: { [Op.in]: ['pending', 'sent'] }
        }
      });

      if (existingMessage) {
        console.log(`[Scheduler] ⚠️ Mensaje duplicado detectado: Ya existe un mensaje tipo '${type}' para cita ${appointmentId}. Saltando...`);
        return existingMessage;
      }
    }

    // Ajustar hora programada al horario laboral si es necesario
    const adjustedScheduledAt = adjustToBusinessHours(new Date(scheduledAt));

    console.log(`[Scheduler] 📅 Hora original: ${scheduledAt}`);
    console.log(`[Scheduler] 📅 Hora ajustada: ${adjustedScheduledAt}`);

    const scheduled = await ScheduledMessage.create({
      businessId,
      appointmentId,
      phone,
      message,
      type,
      scheduledAt: adjustedScheduledAt,
      status: 'pending',
      retryCount: 0
    });

    console.log(`[Scheduler] ✅ Mensaje guardado en BD: ${scheduled.id} con scheduledAt: ${scheduled.scheduledAt}`);
    return scheduled;
  } catch (error) {
    console.error('[Scheduler] ❌ Error programando mensaje:', error.message);
    throw error;
  }
}

/**
 * Cancela mensajes pendientes de una cita
 * Útil cuando se cancela una cita
 */
async function cancelAppointmentMessages(appointmentId) {
  try {
    const result = await ScheduledMessage.update(
      { status: 'cancelled' },
      {
        where: {
          appointmentId,
          status: { [Op.in]: ['pending', 'failed'] }
        }
      }
    );

    console.log(`[Scheduler] 🚫 ${result[0]} mensajes cancelados para cita ${appointmentId}`);
    return result[0];
  } catch (error) {
    console.error('[Scheduler] ❌ Error cancelando mensajes:', error.message);
    return 0;
  }
}

/**
 * Obtiene estadísticas de mensajes programados
 */
async function getStats(businessId = null) {
  const where = businessId ? { businessId } : {};
  
  const stats = await ScheduledMessage.findAll({
    where,
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true
  });

  return stats;
}


module.exports = {
  runScheduler,
  scheduleMessage,
  cancelAppointmentMessages,
  getStats,
  isBusinessHours
};
