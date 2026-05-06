const express = require('express');
const router = express.Router();
const kadyController = require('../controllers/kady/kadyController');

/**
 * Rutas públicas para el chatbot Kady
 */

// Obtener info inicial del negocio por slug
router.get('/business/:slug', kadyController.getInitialData);

// Consultar citas por nombre (usando query params ?slug=...&fullName=...)
router.get('/appointments', kadyController.getAppointments);

// Registrar nueva cita pendiente
router.post('/appointments/:slug', kadyController.bookAppointment);

// Obtener empleados (profesionales) del negocio
router.get('/employees/:slug', kadyController.getEmployees);

// Obtener horarios disponibles (usando query params)
router.get('/slots', kadyController.getSlots);

module.exports = router;
