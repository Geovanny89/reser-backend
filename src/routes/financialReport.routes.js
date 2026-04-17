const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/financialReport.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Obtener informe financiero completo
router.get('/', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.getFinancialReport);

module.exports = router;
