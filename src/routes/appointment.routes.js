const router = require('express').Router();
const ctrl   = require('../controllers/appointment.controller');
const auth   = require('../middleware/auth');
const role   = require('../middleware/role');

/**
 * @swagger
 * tags:
 *   name: Appointments
 *   description: Gestion de citas y reservas
 */

/**
 * @swagger
 * /appointments:
 *   post:
 *     summary: Crear una nueva cita (publico o autenticado)
 *     tags: [Appointments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [businessId, serviceId, employeeId, startTime, clientName, clientPhone]
 *             properties:
 *               businessId:  { type: string, format: uuid }
 *               serviceId:   { type: string, format: uuid }
 *               employeeId:  { type: string, format: uuid }
 *               startTime:   { type: string, format: date-time }
 *               clientName:  { type: string, example: "Juan Perez" }
 *               clientPhone: { type: string, example: "+57 300 000 0000" }
 *               notes:       { type: string }
 *     responses:
 *       201:
 *         description: Cita creada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Appointment'
 */
router.post('/', ctrl.create);

/**
 * @swagger
 * /appointments/my-client-appointments:
 *   get:
 *     summary: Citas del cliente (autenticado o por email)
 *     tags: [Appointments]
 *     parameters:
 *       - in: query
 *         name: email
 *         schema: { type: string, format: email }
 */
router.get('/my-client-appointments', (req, res, next) => {
  // Si viene email en query, permitimos pasar sin auth (modo cliente simplificado)
  if (req.query.email) return next();
  // Si no, requerimos auth
  return auth(req, res, next);
}, ctrl.getMyClientAppointments);

router.use(auth);

/**
 * @swagger
 * /appointments:
 *   get:
 *     summary: Listar citas del negocio (admin/superadmin)
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, cancelled, completed] }
 *     responses:
 *       200:
 *         description: Lista de citas
 */
router.get('/', role('admin', 'superadmin'), ctrl.getByBusiness);
router.get('/business/:businessId', role('admin', 'superadmin'), ctrl.getByBusiness);

/**
 * @swagger
 * /appointments/my:
 *   get:
 *     summary: Citas del empleado autenticado
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de citas del empleado
 */
router.get('/my', role('employee'), ctrl.getMyAppointments);

/**
 * @swagger
 * /appointments/{id}/status:
 *   patch:
 *     summary: Actualizar estado de una cita
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [pending, confirmed, cancelled, completed] }
 *     responses:
 *       200:
 *         description: Estado actualizado
 */
router.patch('/:id/status', role('admin', 'superadmin', 'employee'), ctrl.updateStatus);

/**
 * @swagger
 * /appointments/{id}/cancel:
 *   patch:
 *     summary: Cancelar una cita
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Cita cancelada
 */
router.patch('/:id/cancel', (req, res, next) => {
  // Si viene clientEmail en el body (modo cliente simplificado en APK), permitimos pasar sin auth
  if (req.body.clientEmail) return next();
  // Si no, requerimos auth normal
  return auth(req, res, next);
}, ctrl.cancel);

/**
 * @swagger
 * /appointments/{id}/send-receipt:
 *   post:
 *     summary: Enviar comprobante de pago por email
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Comprobante enviado
 *       400:
 *         description: La cita no está completada
 */
router.post('/:id/send-receipt', role('admin', 'superadmin'), ctrl.sendReceipt);

/**
 * @swagger
 * /appointments/availability:
 *   get:
 *     summary: Obtener disponibilidad de horarios
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: employeeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: serviceId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lista de horarios disponibles
 */
router.get('/availability', role('admin', 'superadmin'), ctrl.getAvailability);

module.exports = router;
