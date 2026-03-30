const router = require('express').Router();
const ctrl   = require('../controllers/businessType.controller');
const auth   = require('../middleware/auth');
const role   = require('../middleware/role');

/**
 * @swagger
 * tags:
 *   name: BusinessTypes
 *   description: Gestión de tipos de negocio
 */

// Ruta pública: obtener tipos activos (para formularios de registro)
router.get('/', ctrl.getAll);

// Rutas protegidas (solo superadmin)
router.use(auth);
router.get('/all', role('superadmin'), ctrl.getAllAdmin);
router.post('/', role('superadmin'), ctrl.create);
router.put('/:id', role('superadmin'), ctrl.update);
router.delete('/:id', role('superadmin'), ctrl.remove);

module.exports = router;
