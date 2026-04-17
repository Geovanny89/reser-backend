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
router.get('/commission-report',     role('admin', 'admin_suc', 'superadmin'), ctrl.getCommissionReport);
router.get('/commissions',           role('admin', 'admin_suc', 'superadmin'), ctrl.getCommissionReport);
router.get('/me/info',               role('employee'), ctrl.getEmployeeInfo);
router.get('/me/commissions',        role('employee'), ctrl.getMyCommissions);
router.get('/me/ratings',            role('employee'), ctrl.getMyRatings);
router.get('/me/clients',            role('employee'), ctrl.getMyFrequentClients);
router.put('/me/profile',            role('employee'), ctrl.updateMyProfile);
router.get('/:employeeId/today',     ctrl.getTodayAppointments);
router.get('/:employeeId/appointments', ctrl.getAppointmentsByDateRange);
router.post('/',                     role('admin', 'admin_suc', 'superadmin'), ctrl.create);
router.post('/invite',               role('admin', 'admin_suc', 'superadmin'), ctrl.invite);
router.put('/:id',                   role('admin', 'admin_suc', 'superadmin'), ctrl.update);
router.delete('/:id',                role('admin', 'admin_suc', 'superadmin'), ctrl.remove);

// ========== RUTAS PARA GESTIÓN DE SERVICIOS POR EMPLEADO ==========

/**
 * @swagger
 * /employees/{employeeId}/services:
 *   get:
 *     summary: Obtener servicios asignados a un empleado
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de servicios del empleado
 */
router.get('/:employeeId/services', ctrl.getEmployeeServices);

/**
 * @swagger
 * /employees/{employeeId}/services:
 *   put:
 *     summary: Asignar servicios a un empleado (reemplaza todos)
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 */
router.put('/:employeeId/services', role('admin', 'admin_suc', 'superadmin'), ctrl.setEmployeeServices);

/**
 * @swagger
 * /employees/{employeeId}/services/{serviceId}:
 *   post:
 *     summary: Agregar un servicio específico a un empleado
 *     tags: [Employees]
 */
router.post('/:employeeId/services/:serviceId', role('admin', 'admin_suc', 'superadmin'), ctrl.addServiceToEmployee);

/**
 * @swagger
 * /employees/{employeeId}/services/{serviceId}:
 *   delete:
 *     summary: Remover un servicio de un empleado
 *     tags: [Employees]
 */
router.delete('/:employeeId/services/:serviceId', role('admin', 'admin_suc', 'superadmin'), ctrl.removeServiceFromEmployee);

/**
 * @swagger
 * /employees/by-service/{serviceId}:
 *   get:
 *     summary: Obtener empleados que pueden realizar un servicio
 *     tags: [Employees]
 */
router.get('/by-service/:serviceId', ctrl.getEmployeesByService);

module.exports = router;
