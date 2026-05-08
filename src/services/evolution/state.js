/**
 * Gestión de estado global del servicio Evolution API
 * Archivo: evolution/state.js
 */

const instances = new Map();
const currentQRs = new Map();
let isProcessingQueue = false;
let isQueueStarting = false; // Flag atómico para evitar inicio concurrente

// TTL de instancias en memoria (2 horas sin uso = stale)
const INSTANCE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
let cleanupInterval = null;

function getInstance(businessId) {
  const entry = instances.get(businessId);
  if (!entry) return undefined;
  // Actualizar lastAccessedAt en lectura
  entry.lastAccessedAt = new Date();
  return entry;
}

/**
 * Devuelve el nombre real de la instancia en la API (pude ser el businessId o un nombre con sufijo)
 */
function getRealInstanceName(businessId) {
  const entry = instances.get(businessId);
  return entry?.instanceName || businessId;
}

function setInstance(businessId, instanceData) {
  const now = new Date();
  instances.set(businessId, {
    ...instanceData,
    createdAt: instanceData.createdAt || now,
    lastAccessedAt: now
  });
}

function deleteInstance(businessId) {
  instances.delete(businessId);
}

function hasInstance(businessId) {
  return instances.has(businessId);
}

function getAllInstances() {
  return Array.from(instances.entries());
}

function getInstanceCount() {
  return instances.size;
}

function getActiveBusinessIds() {
  return Array.from(instances.keys());
}

function setQR(businessId, qrData) {
  currentQRs.set(businessId, qrData);
}

function getQR(businessId) {
  return currentQRs.get(businessId);
}

function deleteQR(businessId) {
  currentQRs.delete(businessId);
}

function hasQR(businessId) {
  return currentQRs.has(businessId);
}

function isQueueProcessing() {
  return isProcessingQueue;
}

function startQueueProcessing() {
  isProcessingQueue = true;
}

function stopQueueProcessing() {
  isProcessingQueue = false;
}

function isStartingQueue() {
  return isQueueStarting;
}

function setStartingQueue(value) {
  isQueueStarting = value;
}

function clearBusinessState(businessId) {
  instances.delete(businessId);
  currentQRs.delete(businessId);
}

function clearAllState() {
  instances.clear();
  currentQRs.clear();
  isProcessingQueue = false;
  isQueueStarting = false;
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Limpia instancias huérfanas que no han sido accedidas en más de INSTANCE_MAX_AGE_MS
 */
function cleanupStaleInstances(maxAgeMs = INSTANCE_MAX_AGE_MS) {
  const now = Date.now();
  let removed = 0;
  for (const [businessId, entry] of instances.entries()) {
    const lastAccessed = entry.lastAccessedAt ? new Date(entry.lastAccessedAt).getTime() : new Date(entry.createdAt).getTime();
    if (now - lastAccessed > maxAgeMs) {
      instances.delete(businessId);
      currentQRs.delete(businessId);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[Evolution State] 🧹 Cleanup: ${removed} instancias huérfanas eliminadas (quedan ${instances.size})`);
  }
  return removed;
}

/**
 * Inicia limpieza automática cada 15 minutos
 */
function startAutoCleanup(intervalMs = 15 * 60 * 1000) {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => cleanupStaleInstances(), intervalMs);
  if (cleanupInterval.unref) cleanupInterval.unref();
  console.log(`[Evolution State] 🧹 Auto-cleanup iniciado cada ${intervalMs / 60000} min`);
}

module.exports = {
  instances,
  getInstance,
  getRealInstanceName,
  setInstance,
  deleteInstance,
  hasInstance,
  getAllInstances,
  getInstanceCount,
  getActiveBusinessIds,
  currentQRs,
  setQR,
  getQR,
  deleteQR,
  hasQR,
  isQueueProcessing,
  startQueueProcessing,
  stopQueueProcessing,
  isStartingQueue,
  setStartingQueue,
  clearBusinessState,
  clearAllState,
  cleanupStaleInstances,
  startAutoCleanup,
  INSTANCE_MAX_AGE_MS
};
