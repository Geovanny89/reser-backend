/**
 * Envío de mensajes y presencia
 * Archivo: evolution/instance.messaging.js
 */
const api = require('./api');
const { formatPhoneForEvolution, extractPhoneFromInstance } = require('./instance.utils');
const { fetchAllInstances, getConnectionState } = require('./instance.queries');

async function sendMessageDirect(businessId, phone, text) {
  try {
    const state = require('./state');
    const formattedPhone = formatPhoneForEvolution(phone);
    if (!formattedPhone) throw new Error(`Número inválido: ${phone}`);

    // Resolver ID real desde el estado (soporta nombres dinámicos)
    let actualId = state.getRealInstanceName(businessId);
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

    const connState = await getConnectionState(actualId);
    if (connState !== 'open' && connState !== 'connected') {
      throw new Error(`WhatsApp no está conectado (estado: ${connState})`);
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
    console.error(`[Evolution API] ❌ Error enviando mensaje a ${phone}:`, err.response?.data || err.message);
    
    // Si es error 500, podría ser el proxy. Intentamos avisar al log.
    if (err.response?.status === 500) {
      console.warn(`[Evolution API] ⚠️ Error 500 detectado. Posible problema de sesión o proxy.`);
    }
    throw err;
  }
}

module.exports = {
  sendMessageDirect
};
