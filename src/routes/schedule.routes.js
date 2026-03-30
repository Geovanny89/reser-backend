const router = require('express').Router();
const ctrl   = require('../controllers/schedule.controller');
const auth   = require('../middleware/auth');
const role   = require('../middleware/role');

router.use(auth);
router.get('/employee/:employeeId',    ctrl.getByEmployee);
router.get('/business/:businessId',    ctrl.getByBusiness);
router.post('/',                       role('admin', 'superadmin'), ctrl.create);
router.put('/:id',                     role('admin', 'superadmin'), ctrl.update);
router.delete('/:id',                  role('admin', 'superadmin'), ctrl.remove);

module.exports = router;
