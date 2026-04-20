const router = require('express').Router();
const ctrl = require('../controllers/superAdmin.controller');
const auth = require('../middleware/auth');
const role = require('../middleware/role');

// Todas las rutas requieren autenticación y rol superadmin
router.use(auth, role('superadmin'));

// ==================== USUARIOS ====================
router.get('/users', ctrl.getAllUsers);
router.get('/users/:id', ctrl.getUserById);
router.post('/users', ctrl.createUser);
router.put('/users/:id', ctrl.updateUser);
router.patch('/users/:id/toggle-status', ctrl.toggleUserStatus);
router.post('/users/:id/reset-password', ctrl.resetPassword);
router.delete('/users/:id', ctrl.deleteUser);

// ==================== IMPERSONACIÓN ====================
router.post('/users/:id/impersonate', ctrl.impersonateUser);

// ==================== ACTIVITY LOGS ====================
router.get('/activity-logs', ctrl.getActivityLogs);
router.get('/activity-logs/stats', ctrl.getActivityStats);

// ==================== REPORTES GLOBALES ====================
router.get('/reports/financial', ctrl.getGlobalFinancialReport);
router.get('/reports/stats', ctrl.getGlobalStats);

module.exports = router;
