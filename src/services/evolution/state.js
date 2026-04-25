/**
 * Gestión de estado global del servicio Evolution API
 * Archivo: evolution/state.js
 */

const instances = new Map();
const currentQRs = new Map();
let isProcessingQueue = false;
let isQueueStarting = false; // Flag atómico para evitar inicio concurrente

function getInstance(businessId) {
  return instances.get(businessId);
}

function setInstance(businessId, instanceData) {
  instances.set(businessId, {
    ...instanceData,
    createdAt: instanceData.createdAt || new Date()
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
}

module.exports = {
  instances,
  getInstance,
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
  clearAllState
};
