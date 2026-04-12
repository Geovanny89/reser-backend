const router = require('express').Router();
const ctrl = require('../controllers/systemSetting.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Publica para que todos los admins/clientes la vean
router.get('/global-notification', ctrl.getGlobalNotification);

// Solo SuperAdmin puede gestionar
router.get('/:key', auth, role('superadmin'), ctrl.getSetting);
router.put('/:key', auth, role('superadmin'), ctrl.updateSetting);

module.exports = router;
