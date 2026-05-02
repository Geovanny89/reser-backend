const router = require('express').Router();
const ctrl   = require('../controllers/schedule.controller');
const auth   = require('../middleware/auth');
const role   = require('../middleware/role');

router.use(auth);
router.get('/employee/:employeeId',    ctrl.getByEmployee);
router.get('/business/:businessId',    ctrl.getByBusiness);
router.post('/bulk',                   role('admin', 'admin_suc', 'superadmin'), ctrl.createBulk);
router.post('/',                       role('admin', 'admin_suc', 'superadmin'), ctrl.create);
router.put('/:id',                     role('admin', 'admin_suc', 'superadmin'), ctrl.update);
router.delete('/:id',                  role('admin', 'admin_suc', 'superadmin'), ctrl.remove);

module.exports = router;
