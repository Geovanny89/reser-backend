/**
 * Envío de mensajes y presencia
 * Archivo: evolution/instance.messaging.js
 */
const api = require('./api');
const { formatPhoneForEvolution } = require('./instance.utils');
const { fetchAllInstances, getConnectionState } = require('./instance.queries');
const { extractPhoneFromInstance } = require('./instance.utils');

async function sendMessageDirect(businessId, phone, text) {
  try {
    const formattedPhone = formatPhoneForEvolution(phone);
    if (!formattedPhone) throw new Error(`Número inválido: ${phone}`);

    // Resolver ID real si el proporcionado no existe
    let actualId = businessId;
    const all = await fetchAllInstances();
    if (!all.find(inst => inst.name === businessId)) {
      const { Business } = require('../../models');
      const biz = await Business.findByPk(businessId);
      if (biz && biz.phone) {
        const cleanPhone = biz.phone.replace(/\D/g, '');
        const mapped = all.find(inst => {
          const iph = extractPhoneFromInstance(inst);
          return iph === cleanPhone || iph === '57' + cleanPhone;
        });
        if (mapped) actualId = mapped.name;
      }
    }

    const state = await getConnectionState(actualId);
    if (state !== 'open' && state !== 'connected') {
      throw new Error(`WhatsApp no está conectado (estado: ${state})`);
    }

    const delay = Math.min(Math.max(text.length * 20, 1500), 5000);
    
    // Typing indicator
    await api.post(`/chat/sendPresence/${actualId}`, {
      number: formattedPhone,
      delay: delay,
      presence: 'composing'
    }).catch(() => {});

    await new Promise(r => setTimeout(r, delay));

    const response = await api.post(`/message/sendText/${actualId}`, {
      number: formattedPhone,
      text: text,
      options: { delay: 500 }
    });

    console.log(`[Evolution API] ✅ Mensaje enviado a ${formattedPhone}`);
    return response.data;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error enviando mensaje:`, err.message);
    throw err;
  }
}

module.exports = {
  sendMessageDirect
};
