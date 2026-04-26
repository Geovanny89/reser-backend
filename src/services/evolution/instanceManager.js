/**
 * Gestión de instancias de Evolution API
 * Archivo: evolution/instanceManager.js
 */

const axios = require('axios');

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY;

console.log(`[Evolution API] Config - URL: ${EVOLUTION_URL}, API_KEY exists: ${!!API_KEY}`);

const api = axios.create({
  baseURL: EVOLUTION_URL,
  headers: { 'apikey': API_KEY },
  timeout: 30000
});

const {
  setInstance,
  getInstance,
  deleteInstance,
  setQR,
  getQR: getQRFromMemory,
  deleteQR,
  getInstanceCount
} = require('./state');

async function createInstance(businessId, forceFresh = false) {
  console.log(`[Evolution API] ⚙️ Gestionando instancia para ${businessId}...`);
  
  try {
    const allInstances = await fetchAllInstances();
    const existingInstance = allInstances.find(inst => inst.name === businessId);
    
    if (existingInstance && !forceFresh) {
      const status = existingInstance.connectionStatus || existingInstance.state || 'unknown';
      console.log(`[Evolution API] ℹ️ Usando instancia existente con estado: ${status}`);
      setInstance(businessId, {
        instanceName: existingInstance.name,
        status: status,
        createdAt: existingInstance.createdAt
      });
      
      // Configurar webhook para instancia existente
      await configureWebhook(businessId);
      
      return existingInstance;
    }
    
    if (forceFresh && existingInstance) {
      console.log(`[Evolution API] 🔄 Eliminando instancia previa...`);
      await stopInstance(businessId);
      await new Promise(r => setTimeout(r, 2000)); // Espera a que la DB se libere
    }
    
    console.log(`[Evolution API] 🆕 Solicitando creación en Evolution API...`);
    const response = await api.post('/instance/create', {
      instanceName: businessId,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      deviceName: "Chrome (Linux)"
    });
    
    console.log(`[Evolution API] 📦 Respuesta createInstance:`, JSON.stringify(response.data, null, 2));
    
    const instanceData = response.data.instance;
    setInstance(businessId, {
      instanceName: instanceData.instanceName,
      status: instanceData.state || instanceData.status, // Evolution API usa 'state'
      createdAt: new Date()
    });

    // IMPORTANTE: Si el QR no viene aquí, no lanzamos error, 
    // dejamos que getQR lo busque con reintentos.
    if (response.data.qrcode?.base64) {
      setQR(businessId, response.data.qrcode.base64);
      console.log(`[Evolution API] ✅ QR guardado en memoria desde createInstance`);
    } else {
      console.log(`[Evolution API] ℹ️ QR no vino en createInstance, se buscará en connect`);
    }
    
    // Configurar webhook para la nueva instancia
    await configureWebhook(businessId);
    
    return instanceData;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error en createInstance:`, err.response?.data || err.message);
    throw err;
  }
}

/**
 * Configura webhook para una instancia específica
 */
async function configureWebhook(businessId) {
  try {
    // Usar host.docker.internal para Docker Desktop en Windows
    const webhookUrl = 'http://72.62.165.89:4000/api/notifications/evolution/webhook';
    
    console.log(`[Evolution API] 🔗 Configurando webhook para ${businessId}: ${webhookUrl}`);
    
    const payload = {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: [
          "QRCODE_UPDATED",
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "MESSAGES_DELETE",
          "SEND_MESSAGE",
          "CONNECTION_UPDATE"
        ]
      }
    };
    
    console.log(`[Evolution API] 📦 Payload:`, JSON.stringify(payload, null, 2));
    
    await api.post(`/webhook/set/${businessId}`, payload);
    
    console.log(`[Evolution API] ✅ Webhook configurado para ${businessId}`);
  } catch (err) {
    console.error(`[Evolution API] ⚠️ Error configurando webhook para ${businessId}:`, JSON.stringify(err.response?.data, null, 2) || err.message);
    // No lanzamos error porque el webhook global podría funcionar
  }
}

/**
 * Obtiene el estado real de conexión desde Evolution API
 */
async function getConnectionState(businessId) {
  try {
    const res = await api.get(`/instance/connectionState/${businessId}`);
    console.log(`[Evolution API] 📡 Estado raw de ${businessId}:`, JSON.stringify(res.data).substring(0, 300));
    // v2.1.2 devuelve { instance: { state: '...' } }
    const state = res.data?.instance?.state || res.data?.state || res.data;
    console.log(`[Evolution API] 📡 Estado extraído de ${businessId}: ${state}`);
    return state;
  } catch (e) {
    console.log(`[Evolution API] ⚠️ Error obteniendo estado de ${businessId}:`, e.response?.status || e.message);
    return null;
  }
}

async function getQR(businessId) {
  try {
    // El QR ya debería estar guardado en memoria cuando se creó la instancia
    const qrCode = getQRFromMemory(businessId);
    
    if (qrCode) {
      console.log(`[Evolution API] 📲 QR recuperado de memoria para ${businessId}`);
      return qrCode;
    }
    
    // PASO 1: Verificar el estado REAL desde Evolution API
    const realState = await getConnectionState(businessId);
    console.log(`[Evolution API] 📡 Estado real de ${businessId}: ${realState}`);
    
    // Si ya está conectado, no hay QR
    if (realState === 'open' || realState === 'connected') {
      console.log(`[Evolution API] ℹ️ La instancia ya está conectada, no hay QR disponible`);
      throw new Error('La instancia ya está conectada. No se requiere QR.');
    }
    
    // PASO 2: Intentar obtener QR según el estado
    let newQR = null;
    
    // Si existe instancia pero no está conectada, intentar obtener QR
    const stateStr = typeof realState === 'string' ? realState : '';
    if (stateStr === 'close' || stateStr === 'connecting' || stateStr === 'disconnected') {
      console.log(`[Evolution API] 📲 Instancia en estado '${stateStr}', intentando obtener QR...`);
      
      // Usar endpoint correcto según código fuente: /instance/connect/
      newQR = await tryGetQRFromConnect(businessId);
      
      // Fallback: intentar con endpoint /instance/qrcode/
      if (!newQR) {
        console.log(`[Evolution API] 🔁 Fallback a /instance/qrcode/...`);
        newQR = await tryGetQRFromQRCode(businessId);
      }
    } else {
      console.log(`[Evolution API] ℹ️ Estado desconocido '${stateStr}', intentando obtener QR de todos modos...`);
      newQR = await tryGetQRFromConnect(businessId);
      if (!newQR) {
        newQR = await tryGetQRFromQRCode(businessId);
      }
    }
    
    // PASO 3: Si no se obtuvo QR, NO recrear automáticamente la instancia
    // Esto evita ciclos infinitos de creación/destrucción
    if (!newQR) {
      console.log(`[Evolution API] ⚠️ No se pudo obtener el QR. La instancia puede estar generándose o hay un problema con Evolution API.`);
      console.log(`[Evolution API] 💡 Sugerencia: Espere unos segundos y vuelva a intentar, o verifique que Evolution API esté funcionando correctamente.`);
      // No recrear la instancia automáticamente - esto causaba ciclos infinitos
    }
    
    if (newQR) {
      setQR(businessId, newQR);
      console.log(`[Evolution API] ✅ QR obtenido y guardado para ${businessId}`);
      return newQR;
    }
    
    throw new Error('No se pudo obtener el QR de Evolution API después de todos los intentos');
    
  } catch (err) {
    console.error(`[Evolution API] ❌ Error obteniendo QR:`, err.message);
    throw err;
  }
}

/**
 * Intenta obtener QR desde endpoint /instance/connect/
 * Este es el endpoint correcto según el código fuente de Evolution API
 */
async function tryGetQRFromConnect(businessId) {
  try {
    console.log(`[Evolution API] 📲 Intentando /instance/connect/${businessId}...`);
    
    let attempts = 0;
    const maxAttempts = 25; // Aumentado: el QR de Baileys puede tardar hasta 90 segundos
    
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`[Evolution API] 📲 Intento ${attempts}/${maxAttempts}...`);
      
      try {
        const response = await api.get(`/instance/connect/${businessId}`);
        console.log(`[Evolution API] 📲 Respuesta:`, JSON.stringify(response.data, null, 2).substring(0, 500));
        
        // Según el código fuente, puede devolver:
        // - instance.qrCode directamente (cuando state es 'connecting')
        // - Un objeto con 'qrcode' property
        let qr = null;
        
        // PRIORIDAD: base64 (imagen) sobre code (pairing string)
        if (response.data?.base64) {
          qr = response.data.base64;
          console.log(`[Evolution API] ✅ QR encontrado en 'base64'`);
        } else if (response.data?.qrcode?.base64) {
          qr = response.data.qrcode.base64;
          console.log(`[Evolution API] ✅ QR encontrado en qrcode.base64`);
        } else if (response.data?.code) {
          qr = response.data.code;
          console.log(`[Evolution API] ✅ QR encontrado en 'code'`);
        } else if (response.data?.qrcode?.code) {
          qr = response.data.qrcode.code;
          console.log(`[Evolution API] ✅ QR encontrado en qrcode.code`);
        } else if (typeof response.data === 'string' && response.data.startsWith('2@')) {
          qr = response.data;
          console.log(`[Evolution API] ✅ QR encontrado como string`);
        } else if (response.data?.instance?.qrcode) {
          qr = response.data.instance.qrcode;
          console.log(`[Evolution API] ✅ QR encontrado en instance.qrcode`);
        }
        
        if (qr) return qr;
        
        // Si count > 0 pero no hay QR, puede estar generándose
        if (response.data?.count > 0 || response.data?.qrcode?.count > 0) {
          console.log(`[Evolution API] ⏳ QR generándose, esperando 4s...`);
          await new Promise(resolve => setTimeout(resolve, 4000));
        } else {
          console.log(`[Evolution API] ⏳ Esperando QR...`);
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      } catch (e) {
        console.log(`[Evolution API] ⚠️ Error intento ${attempts}:`, e.response?.status || e.message);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    return null;
  } catch (e) {
    console.log(`[Evolution API] ❌ Error en tryGetQRFromConnect:`, e.message);
    return null;
  }
}

/**
 * Intenta obtener QR desde endpoint /instance/qrcode/ (fallback)
 */
async function tryGetQRFromQRCode(businessId) {
  try {
    console.log(`[Evolution API] 📲 Intentando /instance/qrcode/${businessId}...`);
    
    let attempts = 0;
    const maxAttempts = 15;
    
    while (attempts < maxAttempts) {
      attempts++;
      console.log(`[Evolution API] 📲 Qrcode intento ${attempts}/${maxAttempts}...`);
      
      try {
        const response = await api.get(`/instance/qrcode/${businessId}`);
        console.log(`[Evolution API] 📲 Qrcode respuesta:`, JSON.stringify(response.data, null, 2).substring(0, 300));
        
        let qr = null;
        if (response.data?.code) {
          qr = response.data.code;
          console.log(`[Evolution API] ✅ QR encontrado en qrcode 'code'`);
        } else if (response.data?.base64) {
          qr = response.data.base64;
          console.log(`[Evolution API] ✅ QR encontrado en qrcode 'base64'`);
        } else if (response.data?.qrcode?.base64) {
          qr = response.data.qrcode.base64;
          console.log(`[Evolution API] ✅ QR encontrado en qrcode.qrcode.base64`);
        }
        
        if (qr) return qr;
        
        console.log(`[Evolution API] ⏳ Qrcode esperando...`);
        await new Promise(resolve => setTimeout(resolve, 4000));
      } catch (e) {
        console.log(`[Evolution API] ⚠️ Qrcode error ${attempts}:`, e.response?.status || e.message);
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
    }
    
    return null;
  } catch (e) {
    console.log(`[Evolution API] ❌ Error en tryGetQRFromQRCode:`, e.message);
    return null;
  }
}

async function stopInstance(businessId) {
  try {
    // PASO 1: Desconectar la instancia primero (requerido por Evolution API)
    console.log(`[Evolution API] 🔌 Desconectando instancia ${businessId}...`);
    try {
      await api.post(`/instance/logout/${businessId}`);
      console.log(`[Evolution API] ✅ Instancia desconectada`);
      // Esperar a que se complete la desconexión
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (logoutErr) {
      // Si la instancia ya está desconectada o no existe, continuar con la eliminación
      console.log(`[Evolution API] ℹ️ Logout no fue necesario o falló:`, logoutErr.response?.status || logoutErr.message);
    }

    // PASO 2: Eliminar la instancia
    console.log(`[Evolution API] 🗑️ Eliminando instancia ${businessId}...`);
    await api.delete(`/instance/delete/${businessId}`);
    deleteInstance(businessId);
    deleteQR(businessId);
    console.log(`[Evolution API] ⏸️ Instancia detenida: ${businessId}`);
    
    // Esperar un momento para asegurar que Evolution API procese la eliminación
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return true;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error deteniendo instancia:`, err.response?.data || err.message);
    return false;
  }
}

async function forceReconnect(businessId) {
  console.log(`[Evolution API] 🔄 Forzando reconexión para ${businessId}...`);
  
  try {
    await stopInstance(businessId);
    await createInstance(businessId, true);
    
    console.log(`[Evolution API] ✅ Reconexión completada para ${businessId}`);
  } catch (err) {
    console.error(`[Evolution API] ❌ Error en reconexión:`, err.message);
    throw err;
  }
}

async function forceDisconnectAllInstances(reason = 'manual') {
  console.log(`[Evolution API] 🚨 Desconectando todas las instancias. Razón: ${reason}`);
  
  const { getActiveBusinessIds } = require('./state');
  let disconnectedCount = 0;
  
  for (const businessId of getActiveBusinessIds()) {
    try {
      await stopInstance(businessId);
      disconnectedCount++;
    } catch (e) {
      console.error(`[Evolution API] ❌ Error desconectando ${businessId}:`, e.message);
    }
  }
  
  console.log(`[Evolution API] ✅ ${disconnectedCount} instancias desconectadas`);
  return disconnectedCount;
}

function formatPhoneForEvolution(phone) {
  if (!phone) return '';
  // Eliminar todo desde @ en adelante (c.us, s.whatsapp.net, etc.)
  let cleaned = String(phone).split('@')[0];
  // Eliminar todo excepto dígitos
  cleaned = cleaned.replace(/\D/g, '');
  // Si es número colombiano de 10 dígitos que empieza con 3, agregar prefijo 57
  if (cleaned.length === 10 && cleaned.startsWith('3')) {
    cleaned = '57' + cleaned;
  }
  return cleaned;
}

async function sendMessageDirect(businessId, phone, text) {
  try {
    const formattedPhone = formatPhoneForEvolution(phone);
    if (!formattedPhone) {
      throw new Error(`Número de teléfono inválido: ${phone}`);
    }

    console.log(`[Evolution API] 📤 Enviando a ${formattedPhone} (original: ${phone})`);

    const response = await api.post(`/message/sendText/${businessId}`, {
      number: formattedPhone,
      text: text,
      delay: 1200
    });
    
    console.log(`[Evolution API] 📨 Mensaje enviado a ${formattedPhone}`);
    return response.data;
  } catch (err) {
    const errorDetail = err.response?.data
      ? JSON.stringify(err.response.data, null, 2)
      : err.message;
    console.error(`[Evolution API] ❌ Error enviando mensaje:`, errorDetail);
    throw err;
  }
}

function hasValidSession(businessId) {
  const instance = getInstance(businessId);
  // Evolution API usa 'open' o 'connected' como estados válidos
  return instance && (instance.status === 'open' || instance.status === 'connected');
}

function extractPhoneFromInstance(instance) {
  // Evolution API devuelve el número en varios formatos posibles
  const raw = instance.ownerJid || instance.owner || instance.number || instance.phone || '';
  if (!raw) return null;
  // Extraer número de formatos como "573001234567@s.whatsapp.net" o "573001234567@c.us"
  const cleaned = String(raw).split('@')[0].replace(/\D/g, '');
  return cleaned || null;
}

async function fetchAllInstances() {
  try {
    const response = await api.get('/instance/fetchInstances');
    const instances = response.data || [];
    console.log(`[Evolution API] 📊 fetchInstances returned ${instances.length} instances`);

    // Guardar número de teléfono en BD para instancias conectadas
    const { WhatsAppSession } = require('../../models');
    for (const inst of instances) {
      const phone = extractPhoneFromInstance(inst);
      if (phone && inst.name) {
        try {
          await WhatsAppSession.update(
            { phoneNumber: phone },
            { where: { businessId: inst.name } }
          );
          console.log(`[Evolution API] 💾 Número guardado para ${inst.name}: ${phone}`);
        } catch (e) {
          // Silencioso: puede que no exista el registro aún
        }
      }
    }

    return instances;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error obteniendo instancias:`, err.response?.status, err.response?.data || err.message);
    return [];
  }
}

async function getInstanceInfo(businessId) {
  try {
    const response = await api.get(`/instance/fetchInstances`);
    const instances = response.data || [];
    const instance = instances.find(inst => inst.name === businessId || inst.instanceName === businessId);
    if (!instance) return null;

    const phone = extractPhoneFromInstance(instance);
    return {
      name: instance.name || instance.instanceName,
      status: instance.connectionStatus || instance.status || instance.state,
      phoneNumber: phone,
      profileName: instance.profileName || null,
      profilePicUrl: instance.profilePicUrl || null
    };
  } catch (err) {
    console.error(`[Evolution API] ❌ Error obteniendo info de instancia ${businessId}:`, err.message);
    return null;
  }
}

module.exports = {
  createInstance,
  getQR,
  stopInstance,
  forceReconnect,
  forceDisconnectAllInstances,
  sendMessageDirect,
  hasValidSession,
  fetchAllInstances,
  getConnectionState,
  getInstanceInfo,
  configureWebhook
};
