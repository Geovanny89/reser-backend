/**
 * Configuración y métricas del scheduler contextual
 */

const CONTEXTUAL_CONFIG = {
  // Ventanas de envío según tipo de mensaje (relativas a hora de cita)
  REMINDER_WINDOWS: {
    '24h': { before: 26 * 60 * 60 * 1000, after: 18 * 60 * 60 * 1000 }, // 18-26h antes (Confirmación)
    '12h': { before: 18 * 60 * 60 * 1000, after: 6 * 60 * 60 * 1000 },  // 6-18h antes (Confirmación)
    '2h': { before: 6 * 60 * 60 * 1000, after: 1.5 * 60 * 60 * 1000 },  // 1.5-6h antes (Confirmación)
    '1h': { before: 1.5 * 60 * 60 * 1000, after: 0 * 60 * 60 * 1000 },   // <1.5h (Sólo Recordatorio)
  },

  // TTL por tipo de recordatorio (para controlar backlog y evitar envíos fuera de contexto)
  REMINDER_TTL: {
    '24h': 4 * 60 * 60 * 1000,    // 4 horas de TTL
    '12h': 2 * 60 * 60 * 1000,    // 2 horas de TTL
    '2h': 45 * 60 * 1000,         // 45 minutos de TTL
    '1h': 20 * 60 * 1000,         // 20 minutos de TTL
  },

  // Grace period para tolerancia a timing drift (5-10 minutos)
  GRACE_PERIOD_MS: 5 * 60 * 1000, // 5 minutos

  // Límites por negocio para simular capacidad humana
  MAX_MESSAGES_PER_HOUR_PER_BUSINESS: 50,
  MAX_MESSAGES_PER_DAY_PER_BUSINESS: 500,

  // Fallback para recordatorios críticos
  CRITICAL_REMINDER_MAX_DELAY_MS: 30 * 60 * 1000, // 30 minutos
  ENABLE_REDUCED_CRITICAL_MESSAGES: true, 

  // Política de reintentos
  MAX_RETRIES: 3,
  RETRY_BACKOFF_MS: [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000],
  
  // Timeout de procesamiento
  PROCESSING_TIMEOUT_MS: 2 * 60 * 1000, // 2 minutos
  
  // Cleanup batch size
  CLEANUP_BATCH_SIZE: 1000,
};

const schedulerMetrics = {
  lagMs: 0,
  backlog: 0,
  droppedMessages: 0,
  onTimeDelivery: 0,
  totalProcessed: 0,
  lastRun: null,
  duplicateAvoided: 0,
  lockContentionCount: 0,
  lockContentionTotal: 0,
  expiredLocks: 0,
  dbUniqueViolations: 0,
  sendFailures: 0,
  retryCount: 0,
  retrySuccess: 0,
  totalSendLatencyMs: 0,
  sendCount: 0,
  recentLatencies: []
};

const GLOBAL_LIMIT_PER_MINUTE = 50;

module.exports = {
  CONTEXTUAL_CONFIG,
  schedulerMetrics,
  GLOBAL_LIMIT_PER_MINUTE
};
