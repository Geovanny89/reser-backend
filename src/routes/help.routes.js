const express = require('express');
const router = express.Router();
const helpController = require('../controllers/help.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');
const multer = require('multer');
const { storage } = require('../config/cloudinary');
const upload = multer({ storage });

/**
 * Rutas para el Asistente de Ayuda (Admin Chatbot)
 */

// Consulta del chatbot (abierto a cualquier admin autenticado)
router.get('/chat', auth, helpController.chatQuery);

// Obtener lista de artículos por categoría
router.get('/articles', auth, helpController.getAllArticles);

// Gestión de artículos (Solo SuperAdmin)
router.post('/articles', auth, role('superadmin'), upload.single('image'), helpController.createArticle);
router.put('/articles/:id', auth, role('superadmin'), upload.single('image'), helpController.updateArticle);
router.delete('/articles/:id', auth, role('superadmin'), helpController.deleteArticle);

module.exports = router;
