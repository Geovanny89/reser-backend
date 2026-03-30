const express = require('express');
const router = express.Router();
const apkController = require('../controllers/apk.controller');
const auth = require('../middleware/auth');

/**
 * @swagger
 * /apk/generate-apk:
 *   post:
 *     summary: Generar APK personalizada para Android
 *     tags: [APK]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               businessId:
 *                 type: string
 *               businessSlug:
 *                 type: string
 *               businessName:
 *                 type: string
 *     responses:
 *       200:
 *         description: APK generada exitosamente
 */
router.post('/generate-apk', auth, apkController.generateAPK);

/**
 * @swagger
 * /apk/generate-ipa:
 *   post:
 *     summary: Generar IPA personalizada para iOS
 *     tags: [APK]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               businessId:
 *                 type: string
 *               businessSlug:
 *                 type: string
 *               businessName:
 *                 type: string
 *     responses:
 *       200:
 *         description: IPA en proceso de generación
 */
router.post('/generate-ipa', auth, apkController.generateIPA);

/**
 * @swagger
 * /apk/download/{slug}/android:
 *   get:
 *     summary: Descargar APK del negocio
 *     tags: [APK]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Archivo APK
 */
router.get('/download/:slug/android', apkController.downloadAPK);

/**
 * @swagger
 * /apk/download/{slug}/ios:
 *   get:
 *     summary: Descargar IPA del negocio
 *     tags: [APK]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Archivo IPA
 */
router.get('/download/:slug/ios', apkController.downloadIPA);

/**
 * @swagger
 * /apk/status/{businessId}:
 *   get:
 *     summary: Obtener estado de generación de APK
 *     tags: [APK]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Estado del APK
 */
router.get('/status/:businessId', auth, apkController.getAPKStatus);
router.get('/check-update/:slug', apkController.checkForUpdate);
router.get('/download/:slug/android', apkController.downloadAPK);

module.exports = router;
