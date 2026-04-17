const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/deposit.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Obtener depósitos del negocio
router.get('/', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.getByBusiness);

// Crear depósito
router.post('/', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.create);

// Actualizar estado del depósito
router.patch('/:id/status', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.updateStatus);

// Aplicar depósito a cita
router.post('/:id/apply', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.applyToAppointment);

// Eliminar depósito
router.delete('/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.remove);

// Obtener depósitos por cliente
router.get('/by-client', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.getByClient);

module.exports = router;
