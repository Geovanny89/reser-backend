/**
 * Servicio de caché en memoria simple
 * No requiere Redis, mejora rendimiento para endpoints públicos
 */
class CacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutos por defecto
  }

  /**
   * Obtener valor del caché
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    // Verificar si expiró
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  /**
   * Guardar valor en caché
   */
  set(key, value, ttl = this.defaultTTL) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
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
   * Obtener estadísticas del caché
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

module.exports = new CacheService();
