/**
 * Procesamiento de mensajes entrantes de clientes
 */
const { getPendingIncomingMessages, findAppointmentsForPhone } = require('./message.queries');

/**
 * Procesa mensajes entrantes pendientes de clientes
 */
async function processIncomingMessages(businessId, client) {
  try {
    const pendingMessages = await getPendingIncomingMessages(businessId);

    if (pendingMessages.length === 0) {
      return { processed: 0, message: 'No hay mensajes entrantes pendientes' };
    }

    console.log(`[Scheduler] 📨 Procesando ${pendingMessages.length} mensajes entrantes pendientes...`);

    let processed = 0;
    let failed = 0;

    for (const msg of pendingMessages) {
      try {
        const result = await processSingleIncomingMessage(businessId, client, msg);
        if (result.success) {
          processed++;
        } else {
          failed++;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (processError) {
        console.error(`[Scheduler] ❌ Error procesando mensaje entrante ${msg.id}:`, processError.message);
        const { IncomingMessage } = require('../../models');
        await IncomingMessage.update(
          {
            status: 'failed',
            errorMessage: processError.message,
            retryCount: msg.retryCount + 1,
          },
          { where: { id: msg.id } }
        );
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
 * Procesa un mensaje entrante individual
 */
async function processSingleIncomingMessage(businessId, client, msg) {
  const phone = msg.phone;
  const appointments = await findAppointmentsForPhone(businessId, phone);

  if (appointments.length === 0) {
    await msg.update({
      status: 'failed',
      errorMessage: 'No se encontraron citas para este número',
      retryCount: msg.retryCount + 1,
    });
    console.log(`[Scheduler] ⚠️ Mensaje entrante ${msg.id.slice(0, 8)}: Sin citas para tel ${phone}`);
    return { success: false, reason: 'no_appointments' };
  }

  const { handleClientResponse } = require('../../evolutionService');

  const mockMsg = {
    body: msg.message,
    from: phone,
    id: { _serialized: msg.whatsappMessageId },
  };

  await handleClientResponse(businessId, client, mockMsg);

  await msg.update({
    status: 'processed',
    processedAt: new Date(),
  });

  console.log(`[Scheduler] ✅ Mensaje entrante ${msg.id.slice(0, 8)} procesado para tel ${phone}`);
  return { success: true };
}

module.exports = {
  processIncomingMessages,
};
