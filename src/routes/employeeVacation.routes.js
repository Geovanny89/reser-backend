const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/employeeVacation.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Obtener vacaciones por empleado
router.get('/employee/:employeeId', auth, role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getByEmployee);

// Obtener todas las vacaciones de un negocio
router.get('/business/:businessId', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.getByBusiness);

// Crear nueva vacación
router.post('/', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.create);

// Actualizar vacación
router.put('/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.update);

// Eliminar vacación
router.delete('/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.remove);

module.exports = router;
