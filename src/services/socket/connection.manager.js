/**
 * Gestión de conexiones y estadísticas
 */

// Mapa de conexiones activas para monitoreo de memoria
const connectionStats = {
  total: 0,
  byBusiness: new Map(),
  byRole: new Map(),
};

/**
 * Actualiza estadísticas de conexión
 */
function updateConnectionStats(action, businessId, role) {
  if (action === 'add') {
    connectionStats.total++;
    connectionStats.byBusiness.set(businessId,
      (connectionStats.byBusiness.get(businessId) || 0) + 1
    );
    connectionStats.byRole.set(role,
      (connectionStats.byRole.get(role) || 0) + 1
    );
  } else {
    connectionStats.total = Math.max(0, connectionStats.total - 1);
    const bizCount = connectionStats.byBusiness.get(businessId) || 0;
    if (bizCount > 1) {
      connectionStats.byBusiness.set(businessId, bizCount - 1);
    } else {
      connectionStats.byBusiness.delete(businessId);
    }
    const roleCount = connectionStats.byRole.get(role) || 0;
    if (roleCount > 1) {
      connectionStats.byRole.set(role, roleCount - 1);
    } else {
      connectionStats.byRole.delete(role);
    }
  }
}

/**
 * Obtiene estadísticas de conexión (para monitoreo)
 */
function getConnectionStats() {
  return {
    total: connectionStats.total,
    byBusiness: Object.fromEntries(connectionStats.byBusiness),
    byRole: Object.fromEntries(connectionStats.byRole),
    memoryUsage: process.memoryUsage(),
  };
}

module.exports = {
  updateConnectionStats,
  getConnectionStats,
};
