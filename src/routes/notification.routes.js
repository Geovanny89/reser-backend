const router = require('express').Router();
const auth   = require('../middleware/auth');
const ctrl   = require('../controllers/notification.controller');

// Todas las rutas requieren autenticación
router.use(auth);

// Enviar resumen de pago a empleado
router.post('/payment-summary', ctrl.sendPaymentSummary);

// Enviar confirmación de cita al cliente
router.post('/appointment-confirmation', ctrl.sendAppointmentConfirmation);

// Enviar bienvenida a nuevo empleado
router.post('/employee-welcome', ctrl.sendEmployeeWelcome);

// Enviar informe mensual al dueño
router.post('/monthly-report', ctrl.sendMonthlyReport);

module.exports = router;
