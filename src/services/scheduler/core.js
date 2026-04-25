/**
 * Núcleo del Scheduler - Función principal de ejecución
 */
const { getIsProcessing, setIsProcessing, CONFIG } = require('./config');
const { isBusinessHours, getColombiaTimeISO } = require('./time.utils');
const { getPendingMessagesGrouped } = require('./message.queries');
const { processBusinessMessages } = require('./business.processor');

/**
 * Función principal del scheduler
 */
async function runScheduler() {
  if (getIsProcessing()) {
    console.log('[Scheduler] ⏳ Procesamiento anterior en curso, saltando...');
    const processingTime = Date.now() - (global.schedulerStartTime || 0);
    if (processingTime > CONFIG.PROCESSING_TIMEOUT_MINUTES * 60 * 1000) {
      console.warn(`[Scheduler] ⚠️ Procesamiento anterior lleva ${Math.round(processingTime / 1000)}s, forzando reset...`);
      setIsProcessing(false);
    } else {
      return { status: 'skipped', reason: 'already_processing', elapsedMs: processingTime };
    }
  }

  global.schedulerStartTime = Date.now();

  if (!isBusinessHours()) {
    const now = new Date();
    const hour = new Date(now.getTime() + (-5 * 60 * 60 * 1000)).getUTCHours();
    console.log(`[Scheduler] ⏰ Fuera de horario laboral Colombia (${hour}:00). Mensajes quedarán en cola.`);
    return {
      status: 'paused',
      reason: 'outside_business_hours',
      colombiaHour: hour,
    };
  }

  setIsProcessing(true);
  const results = {
    processed: 0,
    sent: 0,
    failed: 0,
    businesses: [],
  };

  try {
    console.log('[Scheduler] 🚀 Iniciando procesamiento de cola...');

    const groupedMessages = await getPendingMessagesGrouped();
    const businessIds = Object.keys(groupedMessages);

    if (businessIds.length === 0) {
      console.log('[Scheduler] ℹ️ No hay mensajes pendientes');
      setIsProcessing(false);
      return { status: 'success', processed: 0, message: 'No pending messages' };
    }

    console.log(`[Scheduler] 📊 ${businessIds.length} negocios con mensajes pendientes`);

    for (const businessId of businessIds) {
      const messages = groupedMessages[businessId];

      console.log(`[Scheduler] ▶️ Procesando negocio ${businessId} (${messages.length} mensajes)`);

      const result = await processBusinessMessages(businessId, messages);

      results.businesses.push({
        businessId,
        ...result,
      });

      if (result.sent) results.sent += result.sent;
      if (result.failed) results.failed += result.failed;
      results.processed += messages.length;

      if (businessIds.indexOf(businessId) < businessIds.length - 1) {
        console.log('[Scheduler] ⏱️ Esperando 10s antes del siguiente negocio...');
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_BUSINESSES));
      }
    }

    console.log(`[Scheduler] ✅ Completado: ${results.sent} enviados, ${results.failed} fallidos`);
    return { status: 'success', ...results };

  } catch (error) {
    console.error('[Scheduler] ❌ Error crítico:', error.message);
    return { status: 'error', error: error.message };
  } finally {
    setIsProcessing(false);
    global.schedulerStartTime = null;
  }
}

module.exports = {
  runScheduler,
};
