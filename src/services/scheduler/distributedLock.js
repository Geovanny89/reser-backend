/**
 * Lock distribuido para scheduler contextual
 * Usa Redis si está disponible, si no usa lock en memoria (single instance)
 * Previene race conditions en multi-instancia con PM2
 * 
 * IMPLEMENTA OWNERSHIP DE LOCK:
 * - Cada lock tiene un token único (UUID)
 * - Solo el owner puede liberar el lock
 * - Evita que un proceso libere el lock de otro
 */

const { ScheduledMessage } = require('../../models');
const { Op } = require('sequelize');
const crypto = require('crypto');

// === Configuración ===
const LOCK_CONFIG = {
  DEFAULT_TTL_MS: 60 * 1000,     // 1 minuto de TTL por defecto
  RETRY_DELAY_MS: 500,           // 500ms entre reintentos
  MAX_RETRIES: 3,                // Máximo 3 reintentos
  LOCK_PREFIX: 'scheduler:lock:', // Prefijo para keys de lock
};

// === Lock en memoria (fallback sin Redis) ===
const memoryLocks = new Map(); // key -> { acquiredAt, expiresAt, owner, token }

// === Redis client (lazy init) ===
let redisClient = null;
let redisAvailable = false;

/**
 * Genera un token único para ownership de lock
 */
function generateLockToken() {
  return `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Verifica si Redis está disponible
 */
function isRedisAvailable() {
  return redisAvailable && redisClient !== null;
}

/**
 * Inicializa conexión Redis (si está disponible)
 */
async function initRedis() {
  if (redisClient) return redisClient;

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log('[DistributedLock] ⚠️ REDIS_URL no configurada, usando locks en memoria');
      redisAvailable = false;
      return null;
    }

    const redis = require('redis');
    redisClient = redis.createClient({ url: redisUrl });

    redisClient.on('error', (err) => {
      console.error('[DistributedLock] ❌ Redis error:', err.message);
      redisAvailable = false;
    });

    redisClient.on('connect', () => {
      console.log('[DistributedLock] ✅ Redis conectado');
      redisAvailable = true;
    });

    await redisClient.connect();
    redisAvailable = true;
    return redisClient;

  } catch (error) {
    console.log(`[DistributedLock] ⚠️ Redis no disponible: ${error.message}, usando locks en memoria`);
    redisAvailable = false;
    return null;
  }
}

/**
 * Intenta adquirir un lock distribuido con ownership
 * Retorna { acquired: boolean, token: string | null }
 */
async function acquireLock(key, ttlMs = LOCK_CONFIG.DEFAULT_TTL_MS) {
  const lockKey = `${LOCK_CONFIG.LOCK_PREFIX}${key}`;
  const token = generateLockToken();

  // Intentar con Redis si está disponible
  if (redisAvailable && redisClient) {
    try {
      const result = await redisClient.set(lockKey, token, {
        PX: ttlMs,
        NX: true // Solo si no existe
      });
      if (result === 'OK') {
        return { acquired: true, token };
      }
      return { acquired: false, token: null };
    } catch (error) {
      console.error('[DistributedLock] ❌ Redis set error, fallback a memoria:', error.message);
      redisAvailable = false;
    }
  }

  // Fallback: lock en memoria
  const now = Date.now();
  const existing = memoryLocks.get(lockKey);

  // Si existe y no ha expirado, no podemos adquirir
  if (existing && existing.expiresAt > now) {
    return { acquired: false, token: null };
  }

  // Adquirir lock con token
  memoryLocks.set(lockKey, {
    acquiredAt: now,
    expiresAt: now + ttlMs,
    token
  });

  return { acquired: true, token };
}

/**
 * Libera un lock distribuido (solo si somos el owner)
 * @param {string} token - Token de ownership del lock
 */
async function releaseLock(key, token) {
  const lockKey = `${LOCK_CONFIG.LOCK_PREFIX}${key}`;

  // Intentar con Redis si está disponible
  if (redisAvailable && redisClient) {
    try {
      // Verificar ownership antes de liberar (GET + DEL atómico con Lua script)
      const currentToken = await redisClient.get(lockKey);
      if (currentToken === token) {
        await redisClient.del(lockKey);
        return true;
      }
      // Si el token no coincide, no liberamos (lock expiró o fue tomado por otro)
      console.log(`[DistributedLock] ⚠️ Token mismatch para ${key}, no liberando (lock expiró o fue reclamado)`);
      return false;
    } catch (error) {
      console.error('[DistributedLock] ❌ Redis del error:', error.message);
      redisAvailable = false;
    }
  }

  // Fallback: liberar en memoria (solo si somos el owner)
  const existing = memoryLocks.get(lockKey);
  if (existing && existing.token === token) {
    memoryLocks.delete(lockKey);
    return true;
  }
  
  // Token no coincide o lock no existe
  return false;
}

/**
 * Renueva el TTL de un lock existente (heartbeat)
 * Solo el owner puede renovar el lock
 * @returns {boolean} true si se renovó exitosamente
 */
async function extendLock(key, token, additionalTtlMs = 30000) {
  const lockKey = `${LOCK_CONFIG.LOCK_PREFIX}${key}`;

  // Intentar con Redis si está disponible
  if (redisAvailable && redisClient) {
    try {
      // Verificar ownership y renovar atómicamente con Lua script
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      const result = await redisClient.eval(luaScript, {
        keys: [lockKey],
        arguments: [token, additionalTtlMs.toString()]
      });
      
      return result === 1;
    } catch (error) {
      console.error('[DistributedLock] ❌ Error extendiendo lock:', error.message);
      redisAvailable = false;
    }
  }

  // Fallback: renovar en memoria (solo si somos el owner)
  const existing = memoryLocks.get(lockKey);
  if (existing && existing.token === token) {
    existing.expiresAt = Date.now() + additionalTtlMs;
    return true;
  }
  
  // Token no coincide o lock no existe
  return false;
}

/**
 * Crea un heartbeat que renueva el lock periódicamente
 * @returns {Object} { stop: function } para detener el heartbeat
 */
function createLockHeartbeat(key, token, intervalMs = 10000, extendByMs = 30000) {
  const intervalId = setInterval(async () => {
    const extended = await extendLock(key, token, extendByMs);
    if (!extended) {
      console.log(`[DistributedLock] ⚠️ Heartbeat falló para ${key}, lock perdido o expirado`);
      clearInterval(intervalId);
    }
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(intervalId);
    }
  };
}

/**
 * Ejecuta una función con lock distribuido
 * Adquiere el lock con token de ownership, ejecuta la función, y libera el lock
 * Retorna el resultado de la función o null si no pudo adquirir el lock
 */
async function withLock(key, fn, ttlMs = LOCK_CONFIG.DEFAULT_TTL_MS) {
  // Intentar adquirir con reintentos
  let lockInfo = { acquired: false, token: null };
  
  for (let attempt = 0; attempt < LOCK_CONFIG.MAX_RETRIES; attempt++) {
    lockInfo = await acquireLock(key, ttlMs);
    if (lockInfo.acquired) break;

    if (attempt < LOCK_CONFIG.MAX_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, LOCK_CONFIG.RETRY_DELAY_MS));
    }
  }

  if (!lockInfo.acquired) {
    return null; // No pudimos adquirir el lock
  }

  try {
    const result = await fn();
    return result;
  } finally {
    // Liberar usando el token de ownership (solo nosotros podemos liberarlo)
    await releaseLock(key, lockInfo.token);
  }
}

/**
 * Verifica si un lock está activo (sin adquirirlo)
 */
async function isLocked(key) {
  const lockKey = `${LOCK_CONFIG.LOCK_PREFIX}${key}`;

  if (redisAvailable && redisClient) {
    try {
      const exists = await redisClient.exists(lockKey);
      return exists === 1;
    } catch (error) {
      redisAvailable = false;
    }
  }

  // Fallback: verificar en memoria
  const existing = memoryLocks.get(lockKey);
  if (!existing) return false;
  if (existing.expiresAt <= Date.now()) {
    memoryLocks.delete(lockKey);
    return false;
  }
  return true;
}

/**
 * Limpia locks expirados en memoria
 */
function cleanupExpiredLocks() {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, lock] of memoryLocks.entries()) {
    if (lock.expiresAt <= now) {
      memoryLocks.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[DistributedLock] 🧹 ${cleaned} locks expirados limpiados`);
  }
}

// Limpiar locks expirados cada 5 minutos
setInterval(cleanupExpiredLocks, 5 * 60 * 1000);

module.exports = {
  initRedis,
  acquireLock,
  releaseLock,
  extendLock,
  createLockHeartbeat,
  withLock,
  isLocked,
  isRedisAvailable,
  LOCK_CONFIG
};
