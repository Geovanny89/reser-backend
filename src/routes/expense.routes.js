const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expense.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Obtener gastos del negocio
router.get('/', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.getByBusiness);

// Crear gasto
router.post('/', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.create);

// Actualizar gasto
router.put('/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.update);

// Eliminar gasto
router.delete('/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.remove);

// Resumen de gastos
router.get('/summary', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.getSummary);

module.exports = router;
