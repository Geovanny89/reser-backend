const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/inventory.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');
const multer = require('multer');

// Configuración de multer para archivos Excel en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Items (Insumos)
router.get('/items', auth, role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getItems);
router.post('/items', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.createItem);
router.put('/items/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.updateItem);
router.delete('/items/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.deleteItem);

// Importar desde Excel
router.post('/import-excel', auth, role('admin', 'admin_suc', 'superadmin'), upload.single('file'), ctrl.importFromExcel);

// Usages (Consumos)
router.get('/usages', auth, role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.getUsages);
router.post('/usages', auth, role('admin', 'admin_suc', 'superadmin', 'employee'), ctrl.recordUsage);
router.put('/usages/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.updateUsage);
router.delete('/usages/:id', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.deleteUsage);

// Stock bajo
router.get('/low-stock', auth, role('admin', 'admin_suc', 'superadmin'), ctrl.getLowStock);

module.exports = router;
