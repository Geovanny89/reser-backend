const router = require('express').Router();
const ctrl   = require('../controllers/appointment');
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
router.get('/stats', auth, ctrl.getStats);

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

/**
 * @swagger
 * /appointments/{id}/cancel:
 *   patch:
 *     summary: Cancelar una cita (cliente sin auth o usuario autenticado)
 *     tags: [Appointments]
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
 *               clientEmail: { type: string, format: email }
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
 * /appointments/{id}/confirm:
 *   get:
 *     summary: Confirmar asistencia a cita (cliente - desde email)
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: token
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Asistencia confirmada
 */
router.get('/:id/confirm', ctrl.confirmAttendance);

/**
 * @swagger
 * /appointments/{id}/cancel-from-email:
 *   get:
 *     summary: Cancelar cita (cliente - desde email)
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 */
router.get('/:id/cancel-from-email', ctrl.cancelFromEmail);

/**
 * @swagger
 * /appointments/{id}/verify:
 *   get:
 *     summary: Verificar si una cita puede ser calificada (público)
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Cita verificada
 *       404:
 *         description: Cita no encontrada
 *       400:
 *         description: Cita no completada o ya calificada
 */
router.get('/:id/verify', ctrl.verifyForRating);

/**
 * @swagger
 * /appointments/{id}/rate:
 *   post:
 *     summary: Calificar empleado después de una cita (cliente - público)
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5, description: 'Calificación 1-5 estrellas' }
 *               comment: { type: string, description: 'Comentario opcional' }
 *     responses:
 *       200:
 *         description: Calificación guardada exitosamente
 *       404:
 *         description: Cita no encontrada
 *       400:
 *         description: La cita no está completada o ya fue calificada
 */
router.post('/:id/rate', ctrl.rateAppointment);

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
router.get('/', role('admin', 'admin_suc', 'superadmin'), ctrl.getByBusiness);
router.get('/consolidated', role('admin', 'admin_suc'), ctrl.getConsolidated);
router.get('/clients', role('admin', 'admin_suc', 'superadmin'), ctrl.getClientsByBusiness);
router.put('/clients', role('admin', 'admin_suc', 'superadmin'), ctrl.updateClient);
router.get('/client-tags', role('admin', 'admin_suc', 'superadmin'), ctrl.getClientTags);
router.post('/client-tags', role('admin', 'admin_suc', 'superadmin'), ctrl.createClientTag);
router.put('/client-tags/:id', role('admin', 'admin_suc', 'superadmin'), ctrl.updateClientTag);
router.delete('/client-tags/:id', role('admin', 'admin_suc', 'superadmin'), ctrl.deleteClientTag);
router.post('/client-tags/assign', role('admin', 'admin_suc', 'superadmin'), ctrl.assignTagToClient);
router.delete('/client-tags/assign/:assignmentId', role('admin', 'admin_suc', 'superadmin'), ctrl.removeTagFromClient);
router.get('/business/:businessId', role('admin', 'admin_suc', 'superadmin'), ctrl.getByBusiness);

// Cumpleaños
router.get('/birthday-templates', role('admin', 'admin_suc', 'superadmin'), ctrl.getBirthdayTemplates);
router.post('/birthday-templates', role('admin', 'admin_suc', 'superadmin'), ctrl.saveBirthdayTemplate);
router.delete('/birthday-templates/:id', role('admin', 'admin_suc', 'superadmin'), ctrl.deleteBirthdayTemplate);

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
router.patch('/:id/status', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.updateStatus);

/**
 * @swagger
 * /appointments/{id}:
 *   put:
 *     summary: Editar una cita existente (fecha, hora, servicio, empleado)
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
 *               clientName: { type: string }
 *               clientPhone: { type: string }
 *               clientEmail: { type: string }
 *               serviceId: { type: string, format: uuid }
 *               employeeId: { type: string, format: uuid }
 *               startTime: { type: string, format: date-time }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Cita actualizada
 *       404:
 *         description: Cita no encontrada
 *       409:
 *         description: Conflicto de horario
 */
router.put('/:id', role('admin', 'admin_suc', 'superadmin'), ctrl.update);

/**
 * @swagger
 * /appointments/{id}/extend-time:
 *   patch:
 *     summary: Extender el tiempo de una cita en curso
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
 *               additionalMinutes: { type: number, example: 15, description: 'Minutos adicionales a agregar' }
 *     responses:
 *       200:
 *         description: Tiempo extendido exitosamente
 *       400:
 *         description: La cita no está en atención o minutos inválidos
 *       409:
 *         description: Hay conflicto con otra cita
 */
router.patch('/:id/extend-time', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.extendTime);

/**
 * @swagger
 * /appointments/{id}/notes:
 *   get:
 *     summary: Obtener notas de una cita
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
 *         description: Lista de notas
 *   post:
 *     summary: Agregar una nota a la cita
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
 *               content: { type: string, description: 'Contenido de la nota' }
 *     responses:
 *       201:
 *         description: Nota creada
 */
router.get('/:id/notes', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getNotes);
router.post('/:id/notes', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.addNote);
router.delete('/:id/notes/:noteId', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.deleteNote);

/**
 * @swagger
 * /appointments/{id}/additional-charge:
 *   patch:
 *     summary: Agregar o modificar cargo adicional a una cita
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
 *               additionalAmount: { type: number, example: 10000 }
 *               additionalNote: { type: string, example: "Figura complicada" }
 *     responses:
 *       200:
 *         description: Cargo adicional agregado
 */
router.patch('/:id/additional-charge', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.addAdditionalCharge);

/**
 * @swagger
 * /appointments/{id}/transfer:
 *   patch:
 *     summary: Transferir cita a otro empleado
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
 *               newEmployeeId: { type: string, format: uuid, description: 'ID del empleado destino' }
 *     responses:
 *       200:
 *         description: Cita transferida exitosamente
 *       409:
 *         description: El empleado destino ya tiene una cita en ese horario
 */
router.patch('/:id/transfer', role('admin', 'admin_suc', 'superadmin'), ctrl.transferAppointment);

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
router.post('/:id/send-receipt', role('admin', 'admin_suc', 'superadmin'), ctrl.sendReceipt);

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

/**
 * @swagger
 * /appointments/{id}/technician-status:
 *   patch:
 *     summary: Actualizar estado del técnico en campo (En Camino, Llegué, En Atención)
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
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [on_the_way, arrived, in_progress], description: 'Estado del técnico' }
 *     responses:
 *       200:
 *         description: Estado actualizado
 *       400:
 *         description: Estado inválido o cita no encontrada
 */
router.patch('/:id/technician-status', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.updateTechnicianStatus);

/**
 * @swagger
 * /appointments/{id}/technical-report:
 *   post:
 *     summary: Guardar reporte técnico con insumos usados
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
 *               diagnosis: { type: string, description: 'Diagnóstico del problema' }
 *               solution: { type: string, description: 'Solución aplicada' }
 *               recommendations: { type: string, description: 'Recomendaciones al cliente' }
 *               partsUsed: { type: array, items: { type: object }, description: 'Insumos usados [{itemId, name, quantity, unit}]' }
 *     responses:
 *       200:
 *         description: Reporte guardado y stock actualizado
 *       400:
 *         description: Datos inválidos
 *   get:
 *     summary: Obtener reporte técnico de la cita
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
 *         description: Reporte técnico
 *       404:
 *         description: No hay reporte para esta cita
 */
router.post('/:id/technical-report', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.saveTechnicalReport);
router.get('/:id/technical-report', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getTechnicalReport);

/**
 * @swagger
 * /appointments/{id}/client-signature:
 *   post:
 *     summary: Guardar firma del cliente
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
 *               signature: { type: string, description: 'Firma en formato base64' }
 *               clientName: { type: string, description: 'Nombre del cliente que firmó' }
 *     responses:
 *       200:
 *         description: Firma guardada exitosamente
 *   get:
 *     summary: Obtener firma del cliente
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
 *         description: Firma del cliente
 *       404:
 *         description: No hay firma para esta cita
 */
router.post('/:id/client-signature', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.saveClientSignature);
router.get('/:id/client-signature', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getClientSignature);

/**
 * @swagger
 * /appointments/{id}/work-evidences:
 *   post:
 *     summary: Guardar evidencias fotográficas del trabajo
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               photos:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                     description:
 *                       type: string
 *               replaceAll:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Evidencias guardadas exitosamente
 *   get:
 *     summary: Obtener evidencias fotográficas del trabajo
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
 *         description: Lista de evidencias
 *   delete:
 *     summary: Eliminar una foto de evidencia
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               photoIndex:
 *                 type: number
 *     responses:
 *       200:
 *         description: Foto eliminada exitosamente
 */
router.post('/:id/work-evidences', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.saveWorkEvidences);
router.get('/:id/work-evidences', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getWorkEvidences);
router.delete('/:id/work-evidences', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.deleteWorkEvidence);

/**
 * @swagger
 * /appointments/{id}/service-order:
 *   get:
 *     summary: Descargar/Ver Orden de Servicio en PDF
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: download
 *         schema: { type: boolean }
 *         description: Si es true, descarga el archivo. Si es false, lo muestra en el navegador.
 *     responses:
 *       200:
 *         description: Archivo PDF de la orden de servicio
 *       404:
 *         description: Cita no encontrada
 */
router.get('/:id/service-order', role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.downloadServiceOrder);

module.exports = router;
