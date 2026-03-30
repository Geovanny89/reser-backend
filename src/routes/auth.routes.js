const router = require('express').Router();
const { login, register, registerVendor, me } = require('../controllers/auth.controller');
const auth = require('../middleware/auth');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Autenticación y registro de usuarios
 */

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registrar un nuevo cliente
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name:     { type: string, example: "Juan Pérez" }
 *               email:    { type: string, format: email, example: "juan@email.com" }
 *               password: { type: string, example: "miPassword123" }
 *     responses:
 *       201:
 *         description: Usuario registrado exitosamente
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/register', register);

/**
 * @swagger
 * /auth/register-vendor:
 *   post:
 *     summary: Registrar un nuevo negocio (admin)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, businessName, businessType]
 *             properties:
 *               name:         { type: string, example: "Carlos López" }
 *               email:        { type: string, format: email }
 *               password:     { type: string }
 *               businessName: { type: string, example: "Barbería El Estilo" }
 *               businessType: { type: string, example: "barberia" }
 *     responses:
 *       201:
 *         description: Negocio y usuario creados exitosamente
 */
router.post('/register-vendor', registerVendor);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Iniciar sesión
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, format: email, example: "admin@kdice.com" }
 *               password: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: Login exitoso, retorna token JWT
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:    { type: string }
 *                 user:     { $ref: '#/components/schemas/User' }
 *                 business: { $ref: '#/components/schemas/Business' }
 *       401:
 *         description: Credenciales inválidas
 */
router.post('/login', login);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Obtener perfil del usuario autenticado
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Datos del usuario actual
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: No autorizado
 */
router.get('/me', auth, me);

module.exports = router;
