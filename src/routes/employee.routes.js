const router = require('express').Router();
const ctrl   = require('../controllers/employee.controller');
const auth   = require('../middleware/auth');
const role   = require('../middleware/role');

/**
 * @swagger
 * tags:
 *   name: Employees
 *   description: Gestión de empleados del negocio
 */

router.use(auth);

/**
 * @swagger
 * /employees:
 *   get:
 *     summary: Listar empleados del negocio
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de empleados
 */
router.get('/business/:businessId',  ctrl.getByBusiness);
router.get('/',                      ctrl.getByBusiness);
router.get('/commission-report',     role('admin', 'superadmin'), ctrl.getCommissionReport);
router.get('/commissions',           role('admin', 'superadmin'), ctrl.getCommissionReport);
router.get('/me/info',               role('employee'), ctrl.getEmployeeInfo);
router.get('/:employeeId/today',     ctrl.getTodayAppointments);
router.get('/:employeeId/appointments', ctrl.getAppointmentsByDateRange);
router.post('/',                     role('admin', 'superadmin'), ctrl.create);
router.post('/invite',               role('admin', 'superadmin'), ctrl.invite);
router.put('/:id',                   role('admin', 'superadmin'), ctrl.update);
router.delete('/:id',                role('admin', 'superadmin'), ctrl.remove);

module.exports = router;
