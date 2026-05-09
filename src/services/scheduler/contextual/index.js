/**
 * Módulo de Scheduler Contextual - Punto de entrada modularizado
 */

const { initRedis } = require('../distributedLock');
const trackers = require('./trackers');
const analysis = require('./analysis');
const utils = require('./utils');
const engine = require('./engine');
const maintenance = require('./maintenance');

// Inicializar Redis para locks distribuidos
initRedis().then(() => {
  console.log('[ContextualScheduler] ✅ Redis locks inicializados');
}).catch(err => {
  console.log('[ContextualScheduler] ⚠️ Redis locks no disponible:', err.message);
  if (process.env.NODE_ENV === 'production') {
    console.error('[ContextualScheduler] 🛑 CRÍTICO: Redis requerido en producción. Scheduler no iniciará.');
    process.exit(1);
  }
});

// Programar limpieza de eventos antiguos cada 24 horas
setInterval(maintenance.cleanupOldReminderEvents, 24 * 60 * 60 * 1000);

module.exports = {
  ...trackers,
  ...analysis,
  ...utils,
  ...engine,
  ...maintenance
};
