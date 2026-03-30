const router = require('express').Router();
const ctrl   = require('../controllers/service.controller');
const auth   = require('../middleware/auth');
const role   = require('../middleware/role');

/**
 * @swagger
 * tags:
 *   name: Services
 *   description: Servicios ofrecidos por el negocio
 */

/**
 * @swagger
 * /services:
 *   get:
 *     summary: Listar servicios del negocio del usuario autenticado
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de servicios
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Service'
 */
router.get('/', ctrl.getByBusiness);
router.get('/business/:businessId', ctrl.getByBusiness);

router.use(auth);

/**
 * @swagger
 * /services:
 *   post:
 *     summary: Crear un nuevo servicio
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, price, durationMin]
 *             properties:
 *               name:        { type: string, example: "Corte de cabello" }
 *               description: { type: string }
 *               price:       { type: number, example: 25000 }
 *               durationMin: { type: integer, example: 30 }
 *     responses:
 *       201:
 *         description: Servicio creado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Service'
 */
router.post('/', role('admin', 'superadmin'), ctrl.create);

/**
 * @swagger
 * /services/{id}:
 *   put:
 *     summary: Actualizar un servicio
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Servicio actualizado
 */
router.put('/:id', role('admin', 'superadmin'), ctrl.update);

/**
 * @swagger
 * /services/{id}:
 *   delete:
 *     summary: Eliminar un servicio
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Servicio eliminado
 */
router.delete('/:id', role('admin', 'superadmin'), ctrl.remove);

module.exports = router;
