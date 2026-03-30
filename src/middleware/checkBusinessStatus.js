const { Business, Employee } = require('../models');

module.exports = async (req, res, next) => {
  // Si no hay usuario (ruta pública), permitimos pasar
  if (!req.user) {
    return next();
  }

  // El superadmin siempre tiene acceso
  if (req.user.role === 'superadmin') {
    return next();
  }

  try {
    let businessId = null;

    // Si es admin, buscamos su negocio
    if (req.user.role === 'admin') {
      const biz = await Business.findOne({ where: { ownerId: req.user.id } });
      if (biz) businessId = biz.id;
    } 
    // Si es empleado, buscamos el negocio al que pertenece
    else if (req.user.role === 'employee') {
      const emp = await Employee.findOne({ where: { userId: req.user.id } });
      if (emp) businessId = emp.businessId;
    }

    if (businessId) {
      const biz = await Business.findByPk(businessId);
      if (biz && biz.status === 'blocked') {
        return res.status(403).json({ 
          error: 'Tu negocio se encuentra bloqueado por falta de pago. Por favor, sube tu comprobante de pago para reactivarlo.',
          blocked: true 
        });
      }
    }

    next();
  } catch (e) {
    next();
  }
};
