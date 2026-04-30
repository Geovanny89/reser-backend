const express = require('express');
const router = express.Router();
const platformReviewController = require('../controllers/platformReview.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Públicas (Landing Page)
router.get('/public', platformReviewController.getPublic);

// Protegidas (Dueños de negocio)
router.get('/status/:businessId', auth, platformReviewController.checkStatus);
router.post('/submit', auth, platformReviewController.submitReview);

// Administrativas (SuperAdmin)
router.get('/admin/all', auth, role('superadmin'), platformReviewController.getAll);
router.put('/admin/moderate/:id', auth, role('superadmin'), platformReviewController.moderate);
router.delete('/admin/:id', auth, role('superadmin'), platformReviewController.remove);

module.exports = router;
