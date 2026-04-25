/**
 * Emisores de eventos Socket.IO para servicios
 * Notifican cambios en tiempo real a admins y empleados
 */

function createServiceEmitters(io) {
  /**
   * Emite creación de servicio
   */
  async function emitServiceCreated(service) {
    if (!io || !service) return;

    console.log(`📢 [Socket] Emitiendo servicio creado ${service.id} a business:${service.businessId}`);
    
    io.to(`business:${service.businessId}`)
      .to(`admin:${service.businessId}`)
      .emit('service:created', service);
  }

  /**
   * Emite actualización de servicio
   */
  async function emitServiceUpdated(service) {
    if (!io || !service) return;

    console.log(`📢 [Socket] Emitiendo servicio actualizado ${service.id} a business:${service.businessId}`);
    
    io.to(`business:${service.businessId}`)
      .to(`admin:${service.businessId}`)
      .emit('service:updated', service);
  }

  /**
   * Emite eliminación de servicio
   */
  async function emitServiceDeleted(serviceId, businessId) {
    if (!io || !serviceId || !businessId) return;

    console.log(`📢 [Socket] Emitiendo servicio eliminado ${serviceId} a business:${businessId}`);
    
    io.to(`business:${businessId}`)
      .to(`admin:${businessId}`)
      .emit('service:deleted', { id: serviceId });
  }

  return {
    emitServiceCreated,
    emitServiceUpdated,
    emitServiceDeleted,
  };
}

module.exports = { createServiceEmitters };
