const router = require('express').Router();
const ctrl   = require('../controllers/business.controller');
const auth   = require('../middleware/auth');
const role   = require('../middleware/role');
const multer = require('multer');
const { storage } = require('../config/cloudinary');

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

/**
 * @swagger
 * tags:
 *   name: Businesses
 *   description: Gestión de negocios
 */

/**
 * @swagger
 * /businesses/by-id/{id}/public:
 *   get:
 *     summary: Obtener información pública de un negocio por ID
 *     tags: [Businesses]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Datos públicos del negocio
 *       404:
 *         description: Negocio no encontrado
 */
router.get('/by-id/:id/public', ctrl.getByIdPublic);

/**
 * @swagger
 * /businesses/{slug}/public:
 *   get:
 *     summary: Obtener información pública de un negocio por slug
 *     tags: [Businesses]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *         example: barberia-el-estilo
 *     responses:
 *       200:
 *         description: Datos públicos del negocio incluyendo servicios y empleados
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Business'
 *       404:
 *         description: Negocio no encontrado
 */
router.get('/:slug/public', ctrl.getBySlug);

/**
 * @swagger
 * /businesses/{slug}/availability:
 *   get:
 *     summary: Consultar disponibilidad de horarios
 *     tags: [Businesses]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *         example: "2025-01-15"
 *       - in: query
 *         name: serviceId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lista de slots disponibles
 */
router.get('/:slug/availability', ctrl.getAvailability);

/**
 * @swagger
 * /businesses/{slug}/reviews:
 *   post:
 *     summary: Crear una reseña para el negocio (público)
 *     tags: [Businesses]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               clientName: { type: string, example: "María Rodriguez" }
 *               rating: { type: integer, minimum: 1, maximum: 5, example: 5 }
 *               comment: { type: string, example: "Un espacio muy bonito, me sentí como en casa" }
 *     responses:
 *       201:
 *         description: Reseña creada exitosamente
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Negocio no encontrado
 */
router.post('/:slug/reviews', ctrl.createReview);

// Rutas protegidas
router.use(auth);

/**
 * @swagger
 * /businesses/my/business:
 *   get:
 *     summary: Obtener el negocio del admin autenticado
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Datos del negocio del admin
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Business'
 */
router.get('/my/business', role('superadmin', 'admin', 'admin_suc'), ctrl.getMyBusiness);
router.get('/my/branches', role('admin', 'admin_suc'), ctrl.getMyBranches);
router.post('/request-branch', role('admin', 'admin_suc'), ctrl.requestBranch);
router.put('/:id/mission-vision', role('admin', 'admin_suc'), ctrl.updateMissionVision);
router.post('/:id/approve-branch', role('superadmin'), ctrl.approveBranch);

/**
 * @swagger
 * /businesses:
 *   get:
 *     summary: Listar todos los negocios (solo superadmin)
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de todos los negocios
 */
router.get('/', role('superadmin'), ctrl.getAll);

/**
 * @swagger
 * /businesses:
 *   post:
 *     summary: Crear un nuevo negocio
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, type]
 *             properties:
 *               name:        { type: string, example: "Barbería El Estilo" }
 *               type:        { type: string, example: "barberia" }
 *               description: { type: string }
 *               phone:       { type: string }
 *               address:     { type: string }
 *               ownerId:     { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Negocio creado exitosamente
 */
router.post('/', role('superadmin', 'admin', 'admin_suc'), ctrl.create);

/**
 * @swagger
 * /businesses/my/business:
 *   put:
 *     summary: Actualizar el negocio del admin autenticado (incluye personalización)
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:           { type: string }
 *               description:    { type: string }
 *               phone:          { type: string }
 *               address:        { type: string }
 *               logoUrl:        { type: string }
 *               bannerUrl:      { type: string }
 *               whatsapp:       { type: string }
 *               instagram:      { type: string }
 *               facebook:       { type: string }
 *               tiktok:         { type: string }
 *               twitter:        { type: string }
 *               website:        { type: string }
 *               primaryColor:   { type: string, example: "#667eea" }
 *               secondaryColor: { type: string, example: "#764ba2" }
 *               tagline:        { type: string }
 *               ctaText:        { type: string }
 *               businessHours:  { type: string }
 *     responses:
 *       200:
 *         description: Negocio actualizado
 */
router.put('/my/business', role('superadmin', 'admin', 'admin_suc'), ctrl.updateMyBusiness);

/**
 * @swagger
 * /businesses/{id}:
 *   put:
 *     summary: Actualizar un negocio por ID (superadmin o admin)
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Negocio actualizado
 */
router.put('/:id', role('superadmin', 'admin'), ctrl.update);

/**
 * @swagger
 * /businesses/{id}:
 *   delete:
 *     summary: Eliminar un negocio (solo superadmin)
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Negocio eliminado
 */
router.delete('/:id', role('superadmin'), ctrl.remove);

/**
 * @swagger
 * /businesses/{id}/toggle-status:
 *   patch:
 *     summary: Activar o bloquear un negocio (solo superadmin)
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Estado del negocio cambiado
 */
router.patch('/:id/toggle-status', role('superadmin'), ctrl.toggleStatus);
router.patch('/:id/status', role('superadmin'), ctrl.toggleStatus); // Alias para Businesses.jsx

/**
 * @swagger
 * /businesses/{id}/subscription:
 *   patch:
 *     summary: Actualizar estado de suscripción (solo superadmin)
 *     tags: [Businesses]
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
 *               subscriptionStatus: { type: string, enum: [pending, paid, overdue] }
 *               lastPaymentDate:    { type: string, format: date }
 *     responses:
 *       200:
 *         description: Suscripción actualizada
 */
router.patch('/:id/subscription', role('superadmin'), ctrl.updateSubscription);
router.patch('/:id/subscription-dates', role('superadmin'), ctrl.updateSubscription); // Alias para Businesses.jsx

// Marcar comprobante como visto
router.patch('/:id/screenshot-viewed', role('superadmin'), ctrl.markScreenshotViewed);

// Aprobar pago automáticamente (superadmin)
router.post('/:id/approve-payment', role('superadmin'), ctrl.approvePayment);

/**
 * @swagger
 * /businesses/my/payment-screenshot:
 *   post:
 *     summary: Subir comprobante de pago
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               screenshot:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Comprobante subido correctamente
 */
router.post('/my/payment-screenshot', role('superadmin', 'admin'), upload.single('screenshot'), ctrl.uploadPaymentScreenshot);

/**
 * @swagger
 * /businesses/my/submit-payment:
 *   post:
 *     summary: Enviar pago con detalles y notificar al admin
 *     tags: [Businesses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               screenshot:
 *                 type: string
 *                 format: binary
 *               paymentAmount:
 *                 type: number
 *               paymentMethod:
 *                 type: string
 *                 enum: [nequi, llave, transferencia, otro]
 *               paymentReference:
 *                 type: string
 *               adminNequiNumber:
 *                 type: string
 *               adminLlaveBancaria:
 *                 type: string
 *               adminBankName:
 *                 type: string
 *               adminAccountNumber:
 *                 type: string
 *     responses:
 *       200:
 *         description: Pago registrado y notificación enviada
 */
router.post('/my/submit-payment', role('superadmin', 'admin'), upload.single('screenshot'), ctrl.submitPayment);

// Gestión de reseñas (protegido)
router.get('/my/reviews', role('superadmin', 'admin', 'admin_suc'), ctrl.getReviews);
router.patch('/reviews/:reviewId/approve', role('superadmin', 'admin', 'admin_suc'), ctrl.toggleReviewApproval);
router.delete('/reviews/:reviewId', role('superadmin', 'admin', 'admin_suc'), ctrl.deleteReview);

module.exports = router;
