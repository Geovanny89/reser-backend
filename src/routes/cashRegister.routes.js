const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const {
  getActiveShift,
  openShift,
  closeShift,
  getShiftMovements,
  createMovement,
  correctMovement,
  getShiftHistory,
  deleteMovement,
  exportHistoryToExcel
} = require('../controllers/cashRegister.controller');

// Obtener turno activo
router.get('/active', authenticate, getActiveShift);

// Abrir nuevo turno
router.post('/shift/open', authenticate, openShift);

// Cerrar turno (corte de caja)
router.post('/shift/close', authenticate, closeShift);

// Obtener movimientos de un turno
router.get('/shifts/:shiftId/movements', authenticate, getShiftMovements);

// Crear movimiento manual
router.post('/movements', authenticate, createMovement);

// Corregir movimiento manual (crea reversa + nuevo)
router.post('/movements/:movementId/correct', authenticate, correctMovement);

// Eliminar movimiento
router.delete('/movements/:movementId', authenticate, deleteMovement);

// Obtener historial de turnos
router.get('/shifts/history', authenticate, getShiftHistory);

// Exportar historial a Excel
router.get('/export/excel', authenticate, exportHistoryToExcel);

module.exports = router;
