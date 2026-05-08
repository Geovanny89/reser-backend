/**
 * Sistema de Keep-Alive para Evolution API
 * Archivo: evolution/heartbeat.js
 * 
 * Mantiene las sesiones de WhatsApp activas enviando pings periódicos
 * y verificando el estado de las instancias.
 */

const axios = require('axios');

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY;

const api = axios.create({
  baseURL: EVOLUTION_URL,
  headers: { 'apikey': API_KEY },
  timeout: 10000,
  proxy: false // Desactivar proxy global para peticiones internas
});

const { getInstance, setInstance, getActiveBusinessIds } = require('./state');

// Configuración
const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // 2 minutos (más frecuente)
const PING_INTERVAL = 1 * 60 * 1000; // 1 minuto para pings activos

// Estado del heartbeat
let heartbeatInterval = null;
let pingInterval = null;

/**
 * Verifica el estado de una instancia específica
 */
async function checkInstanceStatus(businessId) {
  try {
    const response = await api.get(`/instance/connectionState/${businessId}`);
    const state = response.data.state || response.data.instance?.state;
    
    console.log(`[Heartbeat] 💓 Estado de ${businessId}: ${state}`);
    
    // Actualizar estado en memoria
    const currentInstance = getInstance(businessId);
    if (currentInstance) {
      setInstance(businessId, {
        ...currentInstance,
        status: state,
        lastChecked: new Date()
      });
    }
    
    return state;
  } catch (err) {
    console.error(`[Heartbeat] ❌ Error verificando ${businessId}:`, err.message);
    return null;
  }
}

/**
 * Envía un ping para mantener la sesión activa
 */
async function pingInstance(businessId) {
  try {
    // Intentar obtener el perfil propio o el estado de conexión
    // Esto obliga a Evolution API a interactuar con el socket de WhatsApp
    await api.get(`/instance/connectionState/${businessId}`);
    
    // Opcional: Hacer un fetch de la configuración para asegurar que el proxy responda
    await api.get(`/instance/fetchInstances`);
    
    console.log(`[Heartbeat] 💓 Ping enviado a ${businessId}`);
    return true;
  } catch (err) {
    console.error(`[Heartbeat] ❌ Error en ping a ${businessId}:`, err.message);
    return false;
  }
}

/**
 * Verifica todas las instancias y reconecta si es necesario
 * Optimizado con Promise.allSettled para ejecución paralela
 */
async function heartbeatCheck() {
  console.log('[Heartbeat] 🔍 Verificando todas las instancias...');
  
  const businessIds = getActiveBusinessIds();
  
  if (businessIds.length === 0) {
    console.log('[Heartbeat] ℹ️ No hay instancias activas para verificar');
    return;
  }
  
  console.log(`[Heartbeat] 🔍 Verificando ${businessIds.length} instancias en paralelo...`);

  await Promise.allSettled(businessIds.map(async (businessId) => {
    const instance = getInstance(businessId);
    const state = await checkInstanceStatus(businessId);
    
    // Estados válidos: open, connected, connecting (en proceso de conexión)
    // Incluimos 'close' como estado temporalmente válido para dar tiempo a la API a auto-reconectarse
    const validStates = ['open', 'connected', 'connecting', 'close'];
    
    // Verificar si la instancia es muy reciente (menos de 3 minutos)
    const isRecent = instance?.createdAt && 
      (new Date() - new Date(instance.createdAt)) < 3 * 60 * 1000;
    
    // Si está en "connecting" por más de 10 minutos, verificar si hay QR pendiente
    const isStuckInConnecting = state === 'connecting' && instance?.createdAt &&
      (new Date() - new Date(instance.createdAt)) > 10 * 60 * 1000;
    
    if (isStuckInConnecting) {
      // NO forzar reconexión si hay un QR pendiente - el usuario necesita tiempo para escanearlo
      const { currentQRs } = require('./state');
      if (currentQRs && currentQRs.has && currentQRs.has(businessId)) {
        console.log(`[Heartbeat] ℹ️ Instancia ${businessId} en connecting con QR pendiente, esperando escaneo... (${Math.round((new Date() - new Date(instance.createdAt)) / 1000)}s)`);
        // Solo forzar reconexión si ha pasado MUCHO tiempo (1 hora) con QR pendiente
        const veryLongWait = (new Date() - new Date(instance.createdAt)) > 60 * 60 * 1000;
        if (!veryLongWait) {
          return; // Esperar más tiempo para que escaneen el QR
        }
        console.log(`[Heartbeat] ⚠️ QR pendiente por más de 1 hora, forzando reconexión suave...`);
      } else {
        console.log(`[Heartbeat] ⚠️ Instancia ${businessId} atascada en connecting (${Math.round((new Date() - new Date(instance.createdAt)) / 1000)}s), forzando reconexión suave...`);
      }
      // RECONEXIÓN SUAVE: No cerrar sesión (logout: false)
      await attemptReconnect(businessId, false);
      return;
    }
    
    if (isRecent && state !== null) {
      console.log(`[Heartbeat] ℹ️ Instancia ${businessId} es reciente (${Math.round((new Date() - new Date(instance.createdAt)) / 1000)}s), omitiendo reconexión automática`);
      return;
    }
    
    if (!state || !validStates.includes(state)) {
      console.log(`[Heartbeat] ⚠️ Instancia ${businessId} desconectada (${state}). Intentando recuperación suave...`);
      
      // Intentar reconectar usando el mismo proxy que ya tiene asignado
      // Logout: false para no perder la sesión si el error es temporal (ej: proxy caído)
      await attemptReconnect(businessId, false);
    }
  }));
}

/**
 * Envía pings a todas las instancias activas
 * Optimizado con Promise.allSettled para ejecución paralela
 */
async function pingAllInstances() {
  const businessIds = getActiveBusinessIds();
  
  if (businessIds.length === 0) {
    return;
  }
  
  console.log(`[Heartbeat] 💓 Enviando pings a ${businessIds.length} instancias en paralelo...`);
  
  await Promise.allSettled(businessIds.map(async (businessId) => {
    await pingInstance(businessId);
  }));
}

/**
 * Intenta reconectar una instancia
 */
async function attemptReconnect(businessId, shouldLogout = false) {
  try {
    const { forceReconnect } = require('./instanceManager');
    
    console.log(`[Heartbeat] 🔄 Reconectando ${businessId} (Logout: ${shouldLogout})...`);
    await forceReconnect(businessId, shouldLogout);
    
    console.log(`[Heartbeat] ✅ Reconexión solicitada para ${businessId}`);
  } catch (err) {
    console.error(`[Heartbeat] ❌ Error reconectando ${businessId}:`, err.message);
  }
}

/**
 * Inicia el sistema de heartbeat
 */
function startHeartbeat() {
  console.log('[Heartbeat] 🚀 Iniciando sistema de keep-alive...');
  
  // Verificar estado cada 4 minutos
  heartbeatInterval = setInterval(heartbeatCheck, HEARTBEAT_INTERVAL);
  
  // Enviar pings cada 2 minutos
  pingInterval = setInterval(pingAllInstances, PING_INTERVAL);
  
  // Ejecutar verificación inicial
  heartbeatCheck();
  
  console.log(`[Heartbeat] ✅ Sistema iniciado (verificación cada ${HEARTBEAT_INTERVAL/60000}min, pings cada ${PING_INTERVAL/60000}min)`);
}

/**
 * Detiene el sistema de heartbeat
 */
function stopHeartbeat() {
  console.log('[Heartbeat] ⏸️ Deteniendo sistema de keep-alive...');
  
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  
  console.log('[Heartbeat] ✅ Sistema detenido');
}

/**
 * Verifica si el heartbeat está activo
 */
function isHeartbeatActive() {
  return heartbeatInterval !== null || pingInterval !== null;
}

module.exports = {
  startHeartbeat,
  stopHeartbeat,
  isHeartbeatActive,
  checkInstanceStatus,
  pingInstance,
  heartbeatCheck
};
