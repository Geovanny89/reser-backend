/**
 * Servicio de caché en memoria simple
 * No requiere Redis, mejora rendimiento para endpoints públicos
 */
class CacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutos por defecto
    this.maxSize = 500;               // máximo de entradas en memoria
    this.purgeInterval = null;
    this._startPurgeInterval();
  }

  _startPurgeInterval() {
    // Limpiar expirados cada 5 minutos para evitar acumulación en heap
    this.purgeInterval = setInterval(() => this.purgeExpired(), 5 * 60 * 1000);
    // Asegurar que el interval no mantenga el proceso vivo solo por él
    if (this.purgeInterval && this.purgeInterval.unref) {
      this.purgeInterval.unref();
    }
  }

  /**
   * Elimina todas las entradas expiradas (sin depender de que alguien llame get)
   */
  purgeExpired() {
    const now = Date.now();
    let deleted = 0;
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
        deleted++;
      }
    }
    if (deleted > 0) {
      console.log(`[CacheService] 🧹 Purga automática: ${deleted} entradas expiradas eliminadas (size: ${this.cache.size})`);
    }
  }

  /**
   * Evict LRU cuando se supera maxSize
   */
  _evictLRU() {
    const firstKey = this.cache.keys().next().value;
    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
      console.log(`[CacheService] ⚠️ Evict LRU: clave ${String(firstKey).slice(0, 40)} eliminada por límite de caché (${this.maxSize})`);
    }
  }

  /**
   * Obtener valor del caché
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    const now = Date.now();
    // Verificar si expiró
    if (now > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // LRU: mover al final (más recientemente usado)
    item.lastAccessedAt = now;
    this.cache.delete(key);
    this.cache.set(key, item);

    return item.value;
  }

  /**
   * Guardar valor en caché
   */
  set(key, value, ttl = this.defaultTTL) {
    const now = Date.now();

    // Si ya existe, actualizar y mover al final (LRU)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict LRU si estamos en el límite
      this._evictLRU();
    }

    this.cache.set(key, {
      value,
      expiresAt: now + ttl,
      lastAccessedAt: now
    });
  }

  /**
   * Eliminar valor del caché
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Invalidar caché por patrón
   */
  invalidatePattern(pattern) {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidar caché de negocio público por slug
   */
  invalidateBusinessPublic(slug) {
    if (slug) {
      this.delete(`business_public_${slug}`);
    }
  }

  /**
   * Limpiar todo el caché
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Detener el intervalo de purga (útil para tests o graceful shutdown)
   */
  stop() {
    if (this.purgeInterval) {
      clearInterval(this.purgeInterval);
      this.purgeInterval = null;
    }
  }

  /**
   * Obtener estadísticas del caché
   */
  getStats() {
    let oldestKey = null;
    let newestKey = null;
    const iter = this.cache.keys();
    const first = iter.next().value;
    let last = first;
    for (const k of iter) { last = k; }
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      oldestKey: first ? String(first).slice(0, 60) : null,
      newestKey: last ? String(last).slice(0, 60) : null,
      keys: Array.from(this.cache.keys()).slice(0, 20)
    };
  }
}

module.exports = new CacheService();
