/**
 * Tareas de mantenimiento y métricas del scheduler
 */

const { AppointmentReminderEvent } = require('../../../models');
const { Op } = require('sequelize');
const { CONTEXTUAL_CONFIG, schedulerMetrics } = require('./config');

/**
 * Limpia eventos de recordatorio antiguos
 */
async function cleanupOldReminderEvents() {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    let totalDeleted = 0;
    let batchDeleted = 0;
    
    do {
      const eventsToDelete = await AppointmentReminderEvent.findAll({
        where: { createdAt: { [Op.lt]: ninetyDaysAgo } },
        attributes: ['id'],
        limit: CONTEXTUAL_CONFIG.CLEANUP_BATCH_SIZE,
        raw: true
      });
      
      if (eventsToDelete.length === 0) break;
      
      const ids = eventsToDelete.map(e => e.id);
      batchDeleted = await AppointmentReminderEvent.destroy({
        where: { id: { [Op.in]: ids } }
      });
      
      totalDeleted += batchDeleted;
      if (batchDeleted === CONTEXTUAL_CONFIG.CLEANUP_BATCH_SIZE) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } while (batchDeleted === CONTEXTUAL_CONFIG.CLEANUP_BATCH_SIZE);
    
    if (totalDeleted > 0) {
      console.log(`[ContextualScheduler] 🧹 ${totalDeleted} eventos antiguos eliminados (>90 días)`);
    }
  } catch (error) {
    console.error('[ContextualScheduler] ❌ Error limpiando eventos antiguos:', error.message);
  }
}

/**
 * Retorna métricas del scheduler
 */
function getSchedulerMetrics() {
  const now = Date.now();
  const onTimePct = schedulerMetrics.totalProcessed > 0
    ? (schedulerMetrics.onTimeDelivery / schedulerMetrics.totalProcessed * 100).toFixed(1)
    : 0;

  const lockContentionRate = schedulerMetrics.lockContentionTotal > 0
    ? (schedulerMetrics.lockContentionCount / schedulerMetrics.lockContentionTotal).toFixed(3)
    : 0;

  const avgSendLatencyMs = schedulerMetrics.sendCount > 0
    ? Math.round(schedulerMetrics.totalSendLatencyMs / schedulerMetrics.sendCount)
    : 0;

  const latencies = schedulerMetrics.recentLatencies.slice().sort((a, b) => a - b);
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] || 0 : 0;
  const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] || 0 : 0;

  const retrySuccessRate = schedulerMetrics.retryCount > 0
    ? (schedulerMetrics.retrySuccess / schedulerMetrics.retryCount).toFixed(2)
    : 1.0;

  return {
    lagMs: schedulerMetrics.lagMs,
    backlog: schedulerMetrics.backlog,
    droppedMessages: schedulerMetrics.droppedMessages,
    onTimeDeliveryPct: parseFloat(onTimePct),
    totalProcessed: schedulerMetrics.totalProcessed,
    lastRun: schedulerMetrics.lastRun,
    lastRunAgo: schedulerMetrics.lastRun ? now - schedulerMetrics.lastRun : null,
    healthy: schedulerMetrics.lastRun && (now - schedulerMetrics.lastRun) < 5 * 60 * 1000,
    duplicateAvoided: schedulerMetrics.duplicateAvoided,
    lockContentionRate: parseFloat(lockContentionRate),
    lockContentionCount: schedulerMetrics.lockContentionCount,
    lockContentionTotal: schedulerMetrics.lockContentionTotal,
    dbUniqueViolations: schedulerMetrics.dbUniqueViolations,
    sendFailures: schedulerMetrics.sendFailures,
    retryCount: schedulerMetrics.retryCount,
    retrySuccessRate: parseFloat(retrySuccessRate),
    avgSendLatencyMs: avgSendLatencyMs,
    p95SendLatencyMs: p95,
    p99SendLatencyMs: p99,
    totalSends: schedulerMetrics.sendCount
  };
}

module.exports = {
  cleanupOldReminderEvents,
  getSchedulerMetrics
};
