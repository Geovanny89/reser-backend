/**
 * Registra una actividad en el sistema
 * @param {Object} req - Objeto request de Express
 * @param {Object} options - Opciones del log
 */
exports.logActivity = async (req, options) => {
  try {
    const { ActivityLog } = require('../models');
    const { 
      action, 
      entityType, 
      entityId, 
      description, 
      oldValues, 
      newValues, 
      metadata,
      businessId: customBusinessId 
    } = options;

    // Intentar obtener el businessId del request si no se pasa uno custom
    let businessId = customBusinessId;
    if (!businessId && req.user) {
      businessId = req.user.businessId || req.headers?.['x-business-id'] || req.params?.businessId;
    }

    await ActivityLog.create({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userRole: req.user?.role,
      businessId: businessId || null,
      action,
      entityType,
      entityId,
      description,
      oldValues,
      newValues,
      metadata,
      ipAddress: req.ip || req.headers?.['x-forwarded-for'] || '127.0.0.1',
      userAgent: req.headers?.['user-agent'] || 'System/Internal'
    });
  } catch (err) {
    console.error('❌ [ActivityLogger] Error al registrar actividad:', err.message);
  }
};
