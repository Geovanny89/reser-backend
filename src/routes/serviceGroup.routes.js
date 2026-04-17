const router = require('express').Router();
const ctrl   = require('../controllers/serviceGroup.controller');
const auth   = require('../middleware/auth');
const role   = require('../middleware/role');

/**
 * @swagger
 * tags:
 *   name: ServiceGroups
 *   description: Grupos de servicios para organizar servicios por categoría
 */

// Rutas públicas (no requieren auth)
router.get('/business/:businessId', ctrl.getByBusiness);

// A partir de aquí requieren autenticación
router.use(auth);

/**
 * @swagger
 * /service-groups:
 *   get:
 *     summary: Listar grupos de servicios del negocio
 *     tags: [ServiceGroups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: businessId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lista de grupos de servicios
 */
router.get('/', role('admin', 'admin_suc', 'superadmin'), ctrl.getByBusiness);

/**
 * @swagger
 * /service-groups:
 *   post:
 *     summary: Crear un nuevo grupo de servicios
 *     tags: [ServiceGroups]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:        { type: string, example: "Uñas" }
 *               description: { type: string }
 *               imageUrl:    { type: string }
 *               order:       { type: integer, default: 0 }
 *               businessId:  { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Grupo creado
 */
router.post('/', role('admin', 'admin_suc', 'superadmin'), ctrl.create);

/**
 * @swagger
 * /service-groups/{id}:
 *   put:
 *     summary: Actualizar un grupo de servicios
 *     tags: [ServiceGroups]
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
 *               name:        { type: string }
 *               description: { type: string }
 *               imageUrl:    { type: string }
 *               order:       { type: integer }
 *     responses:
 *       200:
 *         description: Grupo actualizado
 */
router.put('/:id', role('admin', 'admin_suc', 'superadmin'), ctrl.update);

/**
 * @swagger
 * /service-groups/{id}:
 *   delete:
 *     summary: Eliminar un grupo de servicios
 *     tags: [ServiceGroups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Grupo eliminado
 */
router.delete('/:id', role('admin', 'admin_suc', 'superadmin'), ctrl.remove);

/**
 * @swagger
 * /service-groups/{id}/services:
 *   post:
 *     summary: Asignar servicios a un grupo
 *     tags: [ServiceGroups]
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
 *             required: [serviceIds]
 *             properties:
 *               serviceIds:  { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Servicios asignados
 */
router.post('/:id/services', role('admin', 'admin_suc', 'superadmin'), ctrl.assignServices);

/**
 * @swagger
 * /service-groups/{id}/services:
 *   delete:
 *     summary: Remover servicios de un grupo
 *     tags: [ServiceGroups]
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
 *             required: [serviceIds]
 *             properties:
 *               serviceIds:  { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: Servicios removidos
 */
router.delete('/:id/services', role('admin', 'admin_suc', 'superadmin'), ctrl.removeServices);

/**
 * @swagger
 * /service-groups/reorder:
 *   post:
 *     summary: Reordenar grupos de servicios
 *     tags: [ServiceGroups]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: businessId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orders]
 *             properties:
 *               orders:  { type: array, items: { type: object, properties: { id: { type: string }, order: { type: integer } } } }
 *     responses:
 *       200:
 *         description: Orden actualizado
 */
router.post('/reorder', role('admin', 'admin_suc', 'superadmin'), ctrl.reorder);

module.exports = router;
