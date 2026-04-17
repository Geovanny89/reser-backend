const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/inventory.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Items (Insumos)
router.get('/items', auth, role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getItems);
router.post('/items', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.createItem);
router.put('/items/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.updateItem);
router.delete('/items/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.deleteItem);

// Usages (Consumos)
router.get('/usages', auth, role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getUsages);
router.post('/usages', auth, role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.recordUsage);

// Stock bajo
router.get('/low-stock', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.getLowStock);

module.exports = router;
