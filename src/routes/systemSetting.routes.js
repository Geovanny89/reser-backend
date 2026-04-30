const router = require('express').Router();
const ctrl = require('../controllers/systemSetting.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Publica para que todos los admins/clientes la vean
router.get('/global-notification', ctrl.getGlobalNotification);

// Cualquiera autenticado puede leer settings, solo SuperAdmin puede actualizar
router.get('/:key', auth, ctrl.getSetting);
router.put('/:key', auth, role('superadmin'), ctrl.updateSetting);

module.exports = router;
