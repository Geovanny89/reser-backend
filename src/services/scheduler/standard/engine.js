/**
 * Motor principal del scheduler estándar
 */

const { ScheduledMessage, IncomingMessage, Appointment } = require('../../../models');
const { Op } = require('sequelize');
const whatsappService = require('../../evolutionService');
const CONFIG = require('./config');
const utils = require('./utils');
const processor = require('./processor');

let isProcessing = false;

/**
 * Obtiene mensajes pendientes agrupados por negocio
 */
async function getPendingMessagesGrouped() {
  const now = new Date();
  console.log(`[Scheduler] 🔍 Buscando mensajes pendientes...`);

  const messages = await ScheduledMessage.findAll({
    where: {
      status: 'pending',
      scheduledAt: { [Op.lte]: now },
      retryCount: { [Op.lt]: CONFIG.MAX_RETRIES }
    },
    order: [['scheduledAt', 'ASC'], ['businessId', 'ASC']],
    limit: CONFIG.BATCH_LIMIT
  });

  console.log(`[Scheduler] 🔍 Mensajes encontrados: ${messages.length}`);

  const grouped = {};
  for (const msg of messages) {
    if (!grouped[msg.businessId]) grouped[msg.businessId] = [];
    grouped[msg.businessId].push(msg);
  }

  return grouped;
}

/**
 * Función principal del scheduler
 */
async function runScheduler() {
  const SCHEDULER_OVERLAP_MS = 14 * 60 * 1000;

  if (isProcessing) {
    const processingTime = Date.now() - (global.schedulerStartTime || 0);
    console.log(`[Scheduler] ⏳ Procesamiento anterior en curso (${Math.round(processingTime / 1000)}s)...`);
    if (processingTime > SCHEDULER_OVERLAP_MS) {
      console.warn(`[Scheduler] ⚠️ Procesamiento anterior lleva ${Math.round(processingTime / 1000)}s, forzando reset...`);
      isProcessing = false;
    } else {
      return { status: 'skipped', reason: 'already_processing', elapsedMs: processingTime };
    }
  }

  global.schedulerStartTime = Date.now();
  isProcessing = true;

  if (!utils.isBusinessHours()) {
    const now = new Date();
    const hour = new Date(now.getTime() - 5 * 60 * 60 * 1000).getUTCHours();
    console.log(`[Scheduler] ⏰ Fuera de horario laboral Colombia (${hour}:00).`);
    isProcessing = false;
    return { status: 'paused', reason: 'outside_business_hours', colombiaHour: hour };
  }

  const results = { processed: 0, sent: 0, failed: 0, businesses: [] };

  try {
    console.log('[Scheduler] 🚀 Iniciando procesamiento de cola...');

    // PASO 0: Procesar mensajes entrantes globales
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const allPendingIncoming = await IncomingMessage.findAll({
        where: { status: 'pending', createdAt: { [Op.gte]: oneWeekAgo } },
        order: [['createdAt', 'ASC']],
        limit: 200
      });
      if (allPendingIncoming.length > 0) {
        console.log(`[Scheduler] 📨 ${allPendingIncoming.length} mensajes entrantes pendientes`);
        const incomingByBusiness = {};
        for (const msg of allPendingIncoming) {
          if (!incomingByBusiness[msg.businessId]) incomingByBusiness[msg.businessId] = [];
          incomingByBusiness[msg.businessId].push(msg);
        }
        for (const [bizId, msgs] of Object.entries(incomingByBusiness)) {
          if (await whatsappService.hasValidSession(bizId)) {
            try {
              const client = await whatsappService.createInstance(bizId);
              for (const msg of msgs.slice(0, 50)) {
                try {
                  const appointments = await Appointment.findAll({
                    where: {
                      businessId: bizId,
                      clientPhone: { [Op.like]: `%${msg.phone}%` },
                      status: { [Op.in]: ['pending', 'confirmed', 'attention', 'done'] }
                    },
                    order: [['startTime', 'DESC']]
                  });
                  if (appointments.length > 0) {
                    const { handleClientResponse } = require('../../evolutionService');
                    await handleClientResponse(bizId, client, {
                      body: msg.message,
                      from: msg.phone,
                      id: { _serialized: msg.whatsappMessageId }
                    });
                    await msg.update({ status: 'processed', processedAt: new Date() });
                  } else {
                    await msg.update({ status: 'failed', errorMessage: 'No se encontraron citas', retryCount: msg.retryCount + 1 });
                  }
                } catch (e) {
                  await msg.update({ status: 'failed', errorMessage: e.message, retryCount: msg.retryCount + 1 });
                }
                await new Promise(r => setTimeout(r, 1000));
              }
            } catch (connErr) {
              console.error(`[Scheduler] ⚠️ Error conectando para mensajes entrantes ${bizId}:`, connErr.message);
            }
          }
        }
      }
    } catch (incomingErr) {
      console.error('[Scheduler] ⚠️ Error procesando mensajes entrantes globales:', incomingErr.message);
    }

    const groupedMessages = await getPendingMessagesGrouped();
    const businessIds = Object.keys(groupedMessages);

    if (businessIds.length === 0) {
      isProcessing = false;
      return { status: 'success', processed: 0, message: 'No pending messages' };
    }

    for (let i = 0; i < businessIds.length; i += CONFIG.CONCURRENT_BUSINESSES) {
      const batch = businessIds.slice(i, i + CONFIG.CONCURRENT_BUSINESSES);
      const batchResults = await Promise.all(
        batch.map(async (businessId) => {
          const result = await processor.processBusinessMessages(businessId, groupedMessages[businessId]);
          return { businessId, ...result };
        })
      );

      for (const batchResult of batchResults) {
        results.businesses.push(batchResult);
        if (batchResult.sent) results.sent += batchResult.sent;
        if (batchResult.failed) results.failed += batchResult.failed;
        results.processed += groupedMessages[batchResult.businessId].length;
      }

      if (i + CONFIG.CONCURRENT_BUSINESSES < businessIds.length) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_BATCHES));
      }
    }

    return { status: 'success', ...results };
  } catch (error) {
    console.error('[Scheduler] ❌ Error crítico:', error.message);
    return { status: 'error', error: error.message };
  } finally {
    isProcessing = false;
    global.schedulerStartTime = null;
  }
}

module.exports = {
  runScheduler
};
