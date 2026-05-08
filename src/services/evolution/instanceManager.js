/**
 * Gestión de instancias de Evolution API
 * Archivo: evolution/instanceManager.js
 */

const axios = require('axios');

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY;

console.log(`[Evolution API] 🔍 Configuración - URL: ${EVOLUTION_URL}, API_KEY: ${API_KEY ? 'Presente' : 'Faltante'}`);

const api = axios.create({
  baseURL: EVOLUTION_URL,
  headers: { 'apikey': API_KEY },
  timeout: 60000, // Aumentado a 60 segundos para dar más tiempo a Evolution API
  proxy: false // Desactivar proxy global para peticiones internas a Evolution API
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

const { getBestProxy } = require('./proxyManager');
const { WhatsAppSession, Business } = require('../../models');
const sequelize = require('../../config/database');

async function createInstance(businessId, forceFresh = false) {
  console.log(`[Evolution API] ⚙️ Gestionando instancia para ${businessId}...`);

  try {
    // 1. Validar que el negocio exista (Imprescindible para la integridad de la DB)
    const biz = await Business.findByPk(businessId);
    if (!biz) {
      console.error(`[Evolution API] ❌ Error: El negocio ${businessId} no existe. Abortando creación.`);
      throw new Error(`El negocio con ID ${businessId} no existe.`);
    }
    const businessName = biz.name || 'Chrome (Linux)';

    const allInstances = await fetchAllInstances();
    const existingInstance = allInstances.find(inst => inst.name === businessId);

    if (existingInstance && !forceFresh) {
      const status = existingInstance.connectionStatus || existingInstance.state || 'unknown';

      // MEJORA: Si la instancia existe pero NO está abierta (incluyendo 'connecting'), 
      // la recreamos para asegurar que se apliquen las nuevas configuraciones.
      if (status !== 'open' && status !== 'connected' && status !== 'connecting') {
        console.log(`[Evolution API] 🔄 Instancia '${businessId}' existe en estado '${status}'. Forzando recreación para aplicar cambios...`);
        forceFresh = true;
      } else {
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
    }

    if (forceFresh) {
      console.log(`[Evolution API] 🔄 Limpiando rastro de instancia previa...`);
      deleteInstance(businessId); // Limpiar memoria local
      deleteQR(businessId);       // Limpiar QR local

      if (existingInstance) {
        await stopInstance(businessId); // Borrar en Evolution API
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`[Evolution API] 🆕 Seleccionando proxy para ${businessId}...`);
    const proxy = await getBestProxy(businessId);

    // Guardar proxy en la base de datos INMEDIATAMENTE para asegurar la reserva (SQL Directo)
    if (proxy) {
      try {
        const { v4: uuidv4 } = require('uuid');
        await sequelize.query(`
          INSERT INTO "WhatsAppSessions" ("id", "businessId", "proxyConfig", "createdAt", "updatedAt")
          VALUES (:id, :businessId, :proxyConfig, NOW(), NOW())
          ON CONFLICT ("businessId") 
          DO UPDATE SET "proxyConfig" = EXCLUDED."proxyConfig", "updatedAt" = NOW()
        `, {
          replacements: {
            id: uuidv4(),
            businessId: businessId,
            proxyConfig: JSON.stringify(proxy)
          }
        });
        console.log(`[Evolution API] 💾 Proxy reservado en DB para ${businessId}: ${proxy.host}`);
      } catch (dbErr) {
        console.error(`[Evolution API] ⚠️ Error reservando proxy en DB (SQL):`, dbErr.message);
      }
    }

    console.log(`[Evolution API] 🆕 DIAGNÓSTICO ID: '${businessId}' (Longitud: ${businessId?.length})`);
    console.log(`[Evolution API] 🆕 Solicitando creación para con nombre: ${businessName}`);

    const createPayload = {
      instanceName: businessId,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      // Orden correcto para Baileys: [SISTEMA, NAVEGADOR, VERSIÓN]
      browser: ["Windows", "Google Chrome", "10.0"],
      settings: {
        rejectCall: false,
        msgCall: "Servicio de Citas Activo"
      }
    };

    if (proxy) {
      console.log(`[Evolution API] 🛡️ Usando proxy para ${businessId}: ${proxy.host}`);
      // Evolution API v2 acepta proxy directamente en el payload de creación
      createPayload.proxy = {
        host: proxy.host,
        port: proxy.port, 
        protocol: proxy.protocol || 'http',
        username: proxy.username || undefined,
        password: proxy.password || undefined
      };
    } else {
      console.log(`[Evolution API] 🌐 No hay proxy disponible para ${businessId}, usando IP del VPS`);
    }

    console.log(`[Evolution API] 🧪 Creación de instancia:`, JSON.stringify(createPayload, null, 2));
    const response = await api.post('/instance/create', createPayload);

    console.log(`[Evolution API] 📦 Respuesta createInstance:`, JSON.stringify(response.data, null, 2));

    // El nombre del navegador ya se envía en el createPayload.
    // Evitamos llamar a /settings/set inmediatamente después de la creación
    // ya que esto provoca un reinicio innecesario del socket de Baileys.

    // APLICAR PROXY VÍA ENDPOINT DEDICADO solo si no se pudo verificar en el paso anterior
    // o si es una instancia pre-existente que necesita actualización.
    if (proxy) {
      try {
        // En v2, el proxy en createPayload suele ser suficiente. 
        // Solo llamamos a /proxy/set si es estrictamente necesario para asegurar persistencia.
        const proxyVerify = await api.get(`/proxy/find/${businessId}`).catch(() => ({ data: null }));
        
        if (!proxyVerify.data?.enabled || proxyVerify.data.host !== proxy.host) {
          const proxySetPayload = {
            enabled: true,
            host: proxy.host,
            port: proxy.port, 
            protocol: proxy.protocol || 'http',
            username: proxy.username || '',
            password: proxy.password || ''
          };
          await api.post(`/proxy/set/${businessId}`, proxySetPayload);
          console.log(`[Evolution API] ✅ Proxy activado vía /proxy/set/ para ${businessId}: ${proxy.host}:${proxy.port}`);
        } else {
          console.log(`[Evolution API] 🛡️ Proxy ya configurado correctamente para ${businessId}`);
        }
      } catch (proxyErr) {
        console.warn(`[Evolution API] ⚠️ Error gestionando proxy (no crítico):`, proxyErr.response?.data || proxyErr.message);
      }
    }

    const instanceData = response.data.instance;
    setInstance(businessId, {
      instanceName: instanceData.instanceName,
      status: instanceData.state || instanceData.status, // Evolution API usa 'state'
      createdAt: new Date()
    });

    // Configurar webhook DE INMEDIATO
    await configureWebhook(businessId);

    // PASO 4: Iniciar búsqueda de QR en SEGUNDO PLANO
    if (!response.data.qrcode?.base64) {
      console.log(`[Evolution API] 🚀 Iniciando búsqueda de QR en segundo plano para ${businessId}`);
      tryGetQRFromConnect(businessId).then(qr => {
        if (qr) setQR(businessId, qr);
      }).catch(e => { });
    } else {
      setQR(businessId, response.data.qrcode.base64);
      console.log(`[Evolution API] ✅ QR guardado desde respuesta inicial`);
    }

    return instanceData;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error en createInstance:`, err.response?.data || err.message);

    // Si el error es 403 (nombre ya en uso), intentar usar la instancia existente
    if (err.response?.status === 403) {
      const errorMsg = JSON.stringify(err.response?.data || '');
      if (errorMsg.includes('already in use') || errorMsg.includes('name')) {
        console.log(`[Evolution API] ℹ️ Nombre ya en uso, intentando usar instancia existente...`);
        try {
          const allInstances = await fetchAllInstances();
          const existingInstance = allInstances.find(inst => inst.name === businessId);
          if (existingInstance) {
            console.log(`[Evolution API] ✅ Usando instancia existente`);
            setInstance(businessId, {
              instanceName: existingInstance.name,
              status: existingInstance.connectionStatus || existingInstance.state || 'unknown',
              createdAt: existingInstance.createdAt
            });
            await configureWebhook(businessId);
            return existingInstance;
          }
        } catch (e) {
          console.log(`[Evolution API] ℹ️ No se pudo obtener instancia existente:`, e.message);
        }
      }
    }

    throw err;
  }
}

/**
 * Configura webhook para una instancia específica
 */
async function configureWebhook(businessId) {
  try {
    // Usar host.docker.internal para Docker Desktop en Windows, o la IP local si es red local
    const webhookHost = process.env.WEBHOOK_HOST || 'host.docker.internal';
    const webhookUrl = `http://${webhookHost}:4000/api/notifications/evolution/webhook`;

    console.log(`[Evolution API] 🔗 Configurando webhook para ${businessId}: ${webhookUrl}`);

    const payload = {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        events: [
          "MESSAGES_UPSERT",
          "CONNECTION_UPDATE",
          "QRCODE_UPDATED"
        ]
      }
    };

    console.log(`[Evolution API] 📦 Payload V2 (Wrapped):`, JSON.stringify(payload, null, 2));

    await api.post(`/webhook/set/${businessId}`, payload);

    console.log(`[Evolution API] ✅ Webhook configurado para ${businessId}`);
  } catch (err) {
    console.error(`[Evolution API] ⚠️ Error configurando webhook para ${businessId}:`, JSON.stringify(err.response?.data, null, 2) || err.message);
    // No lanzamos error porque el webhook global podría funcionar
  }
}

const statusCache = new Map();
const STATUS_CACHE_TTL = 10000; // 10 segundos

/**
 * Obtiene el estado real de conexión desde Evolution API (con caché)
 */
async function getConnectionState(businessId) {
  const now = Date.now();
  const cached = statusCache.get(businessId);

  if (cached && (now - cached.timestamp < STATUS_CACHE_TTL)) {
    return cached.state;
  }

  try {
    const res = await api.get(`/instance/connectionState/${businessId}`);
    // v2.1.2 devuelve { instance: { state: '...' } }
    const state = res.data?.instance?.state || res.data?.state || res.data;

    statusCache.set(businessId, { state, timestamp: now });
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
    console.log(`[Evolution API] 🔍 Iniciando búsqueda activa de QR para ${businessId}...`);

    let attempts = 0;
    const maxAttempts = 60; // 60 intentos * 2s = 120 segundos

    while (attempts < maxAttempts) {
      attempts++;

      try {
        const response = await api.get(`/instance/connect/${businessId}`);
        console.log(`[Evolution API] 📡 Respuesta /instance/connect/${businessId}:`, JSON.stringify(response.data).substring(0, 500));

        let qr = response.data?.base64 ||
          response.data?.qrcode?.base64 ||
          response.data?.code ||
          response.data?.qrcode?.code;

        if (qr) {
          console.log(`[Evolution API] ✅ QR obtenido con éxito en intento ${attempts}`);
          return qr;
        }

        // Si no, intentar con el endpoint específico de qrcode
        const qrcodeResp = await api.get(`/instance/qrcode/${businessId}`);
        let qrAlt = qrcodeResp.data?.base64 || qrcodeResp.data?.code;

        if (qrAlt) {
          console.log(`[Evolution API] ✅ QR obtenido vía endpoint alternativo en intento ${attempts}`);
          return qrAlt;
        }

      } catch (e) {
        // Ignorar errores mientras se inicializa
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.error(`[Evolution API] ❌ No se pudo obtener el QR después de ${maxAttempts} intentos`);
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

async function stopInstance(businessId, shouldLogout = true) {
  try {
    // PASO 0: Verificar estado real de la instancia
    let state = null;
    try {
      state = await getConnectionState(businessId);
      console.log(`[Evolution API] 📡 Estado actual de ${businessId}: ${state}`);
    } catch (e) {
      console.log(`[Evolution API] ℹ️ No se pudo obtener estado, asumiendo que no existe`);
    }

    // PASO 1: Intentar desconectar siempre que la instancia exista
    if (state && state !== 'unknown') {
      console.log(`[Evolution API] 🔌 Forzando desconexión de instancia ${businessId} (estado: ${state}, logout: ${shouldLogout})...`);

      // Solo hacer logout si se solicita explícitamente
      if (shouldLogout) {
        try {
          await api.delete(`/instance/logout/${businessId}`);
          console.log(`[Evolution API] 🚪 Logout ejecutado para ${businessId}`);
        } catch (e) { 
          console.log(`[Evolution API] ℹ️ Error en logout (posiblemente ya desconectado):`, e.message);
        }
      }

      try {
        await api.post(`/instance/disconnect/${businessId}`);
        console.log(`[Evolution API] 🔌 Disconnect ejecutado para ${businessId}`);
      } catch (e) { }

      // Esperar un momento corto para que la API procese la desconexión
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // PASO 2: Eliminar la instancia con reintentos
    console.log(`[Evolution API] 🗑️ Eliminando instancia ${businessId} de Evolution API...`);
    let deleteAttempts = 0;
    const maxDeleteAttempts = 3;

    while (deleteAttempts < maxDeleteAttempts) {
      deleteAttempts++;
      try {
        await api.delete(`/instance/delete/${businessId}`);
        console.log(`[Evolution API] ✅ Instancia eliminada en intento ${deleteAttempts}`);
        break;
      } catch (deleteErr) {
        console.log(`[Evolution API] ⚠️ Intento ${deleteAttempts}/${maxDeleteAttempts} falló:`, deleteErr.response?.status || deleteErr.message);

        if (deleteAttempts < maxDeleteAttempts) {
          // Si falla con 400 o 422, intentar desconectar de nuevo agresivamente
          if (deleteErr.response?.status === 400 || deleteErr.response?.status === 422) {
             console.log(`[Evolution API] 🔄 Re-intentando desconexión forzada antes de borrar...`);
             if (shouldLogout) try { await api.delete(`/instance/logout/${businessId}`); } catch (e) { }
             try { await api.post(`/instance/disconnect/${businessId}`); } catch (e) { }
             await new Promise(resolve => setTimeout(resolve, 3000));
          }

          // Si dice que necesita estar desconectada, esperar más
          const errorMsg = JSON.stringify(deleteErr.response?.data || '');
          if (errorMsg.includes('disconnected') || errorMsg.includes('needs to be')) {
            console.log(`[Evolution API] ⏳ Esperando más tiempo para desconexión...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } else {
          console.error(`[Evolution API] ❌ No se pudo eliminar después de ${maxDeleteAttempts} intentos`);
          return false;
        }
      }
    }

    deleteInstance(businessId);
    deleteQR(businessId);
    console.log(`[Evolution API] ⏸️ Instancia detenida localmente: ${businessId}`);

    // Esperar más tiempo para asegurar que Evolution API procese la eliminación
    await new Promise(resolve => setTimeout(resolve, 3000));

    return true;
  } catch (err) {
    console.error(`[Evolution API] ❌ Error deteniendo instancia:`, err.response?.data || err.message);
    return false;
  }
}

async function forceReconnect(businessId, shouldLogout = false) {
  console.log(`[Evolution API] 🔄 Forzando reconexión para ${businessId} (Logout: ${shouldLogout})...`);

  try {
    // Si la instancia está 'open', primero intentar un simple disconnect/connect antes de borrar
    const currentState = await getConnectionState(businessId);
    if (currentState === 'open' || currentState === 'connected') {
      console.log(`[Evolution API] 🔄 Instancia está 'open', intentando reinicio suave...`);
      try {
        await api.post(`/instance/disconnect/${businessId}`);
        await new Promise(r => setTimeout(r, 2000));
        await api.get(`/instance/connect/${businessId}`);
        console.log(`[Evolution API] ✅ Reinicio suave completado para ${businessId}`);
        return true;
      } catch (e) {
        console.log(`[Evolution API] ⚠️ Reinicio suave falló, procediendo con recreación:`, e.message);
      }
    }

    await stopInstance(businessId, shouldLogout);
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

/**
 * Mapa de prefijos de país conocidos.
 * Si el número ya inicia con alguno de estos, se usa directamente.
 * Orden importa: los más largos primero para evitar falsos positivos.
 */
const KNOWN_COUNTRY_CODES = [
  { code: '57', length: 10, startsWith: '3' },  // Colombia: 10 dígitos, empieza en 3
  { code: '58', length: 10, startsWith: '4' },  // Venezuela: 10 dígitos después de quitar el 0 inicial (04XX → 58 4XX)
  { code: '51', length: 9, startsWith: null },   // Perú: 9 dígitos
  { code: '52', length: 10, startsWith: null },   // México: 10 dígitos
  { code: '54', length: 10, startsWith: null },   // Argentina: 10 dígitos
  { code: '55', length: 11, startsWith: null },   // Brasil: 11 dígitos
  { code: '593', length: 9, startsWith: null },   // Ecuador: 9 dígitos
  { code: '506', length: 8, startsWith: null },   // Costa Rica: 8 dígitos
  { code: '1', length: 10, startsWith: null },   // EEUU/Canadá: 10 dígitos
];

function formatPhoneForEvolution(phone) {
  if (!phone) return '';

  // Eliminar lo que viene desde '@' (formato WhatsApp interno)
  let cleaned = String(phone).split('@')[0];
  // Eliminar todo excepto dígitos
  cleaned = cleaned.replace(/\D/g, '');

  if (!cleaned) return '';

  // ─── CASO 1: Ya tiene prefijo de país ──────────────────────────────────
  // Si el número tiene más de 11 dígitos, casi seguro ya tiene código de país
  if (cleaned.length > 11) {
    return cleaned;
  }

  // ─── CASO 2: Detectar Venezuela (números que empiezan con 0) ──────────
  // Venezuela: 0414-XXX-XXXX → quitar el 0, agregar 58 → 584XXXXXXXXX
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const withoutLeadingZero = cleaned.substring(1); // Quitar el 0 inicial
    return '58' + withoutLeadingZero;
  }

  // ─── CASO 3: Colombia (10 dígitos, empieza con 3) ─────────────────────
  if (cleaned.length === 10 && cleaned.startsWith('3')) {
    return '57' + cleaned;
  }

  // ─── CASO 4: Intentar detectar por longitud y prefijos conocidos ───────
  for (const country of KNOWN_COUNTRY_CODES) {
    if (cleaned.length === country.length) {
      if (!country.startsWith || cleaned.startsWith(country.startsWith)) {
        return country.code + cleaned;
      }
    }
  }

  // ─── CASO 5: Si ya empieza con un código de país conocido, usarlo tal cual
  for (const country of KNOWN_COUNTRY_CODES) {
    if (cleaned.startsWith(country.code)) {
      return cleaned; // Ya tiene prefijo
    }
  }

  // ─── FALLBACK: Devolver como está (podría ser ya un número completo) ───
  console.warn(`[Evolution API] ⚠️ No se pudo determinar el código de país para: ${phone} (limpiado: ${cleaned})`);
  return cleaned;
}

async function sendMessageDirect(businessId, phone, text) {
  if (process.env.MOCK_WHATSAPP === 'true') {
    console.log(`[Evolution API] 🟡 MOCK ACTIVADO: Simulando envío de mensaje a ${phone}: ${text.substring(0, 30)}...`);
    await new Promise(resolve => setTimeout(resolve, 300)); // Simular latencia de red
    return { status: 'mock_success', message: 'Mensaje simulado por MOCK_WHATSAPP' };
  }

  try {
    const formattedPhone = formatPhoneForEvolution(phone);
    if (!formattedPhone) {
      throw new Error(`Número de teléfono inválido: ${phone}`);
    }

    // Verificar estado de conexión ANTES de intentar enviar (evita timeout de 60s)
    let connectionState = await getConnectionState(businessId);
    
    // Si es null, intentar una vez más después de un pequeño delay
    if (connectionState === null) {
      console.log(`[Evolution API] ⏳ Estado de conexión null para ${businessId}, reintentando...`);
      await new Promise(r => setTimeout(r, 2000));
      connectionState = await getConnectionState(businessId);
    }

    if (connectionState !== 'open' && connectionState !== 'connected') {
      console.warn(`[Evolution API] ⚠️ Intento de envío fallido: WhatsApp no está conectado (estado: ${connectionState}) para ${businessId}`);
      throw new Error(`WhatsApp no está conectado (estado: ${connectionState}). No se puede enviar mensaje.`);
    }

    console.log(`[Evolution API] 📤 Preparando mensaje para ${formattedPhone} (ID: ${businessId})`);

    // Calcular delay dinámico según longitud del texto (mín 1.5s, máx 5s) para simular escritura humana
    const dynamicDelay = Math.min(Math.max(text.length * 20, 1500), 5000);

    // PASO 1: Activar indicador "Escribiendo..." ANTES de enviar el mensaje
    try {
      await api.post(`/chat/sendPresence/${businessId}`, {
        number: formattedPhone,
        delay: dynamicDelay,
        presence: 'composing'
      });
    } catch (presenceErr) {
      console.warn(`[Evolution API] ⚠️ No se pudo activar typing indicator:`, presenceErr.message);
    }

    // PASO 2: Esperar el tiempo de "escritura"
    await new Promise(resolve => setTimeout(resolve, dynamicDelay));

    // PASO 3: Enviar el mensaje
    console.log(`[Evolution API] 🚀 Ejecutando /message/sendText/${businessId} para ${formattedPhone}`);
    const response = await api.post(`/message/sendText/${businessId}`, {
      number: formattedPhone,
      text: text,
      options: {
        delay: 500
      }
    });

    console.log(`[Evolution API] ✅ Mensaje enviado exitosamente a ${formattedPhone}`);
    return response.data;
  } catch (err) {
    const errorDetail = err.response?.data
      ? JSON.stringify(err.response.data, null, 2)
      : err.message;
    console.error(`[Evolution API] ❌ Error enviando mensaje:`, errorDetail);
    throw err;
  }
}

async function hasValidSession(businessId) {
  if (process.env.MOCK_WHATSAPP === 'true') {
    console.log(`[Evolution API] 🟡 MOCK ACTIVADO: Simulando sesión válida para ${businessId}`);
    return true;
  }

  try {
    // PASO 1: Verificar que la instancia existe en Evolution API
    const allInstances = await fetchAllInstances();
    const exists = allInstances.find(inst => inst.name === businessId);

    if (!exists) {
      console.log(`[Evolution API] ⚠️ Instancia ${businessId} no existe en Evolution API`);
      return false;
    }

    // PASO 2: Verificar el estado de conexión real
    const realState = await getConnectionState(businessId);
    return realState === 'open' || realState === 'connected';
  } catch (e) {
    console.error(`[Evolution API] ❌ Error verificando sesión válida para ${businessId}:`, e.message);
    return false;
  }
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
