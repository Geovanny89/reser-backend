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
 * /appointments/my-client-appointments:
 *   get:
 *     summary: Citas del cliente autenticado
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de citas del cliente
 */
router.get('/my-client-appointments', role('client'), ctrl.getMyClientAppointments);

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
router.patch('/:id/cancel', ctrl.cancel);

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

// Endpoint de prueba para disponibilidad
router.get('/test-availability', (req, res) => {
  console.log('Endpoint de prueba alcanzado');
  res.json({ 
    message: 'Endpoint de prueba funcionando',
    availableSlots: ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30']
  });
});

module.exports = router;
