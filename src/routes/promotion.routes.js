const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotion.controller');
const auth = require('../middleware/auth');

// Prueba básica sin rol ni business status
router.post('/', auth, promotionController.create);
router.get('/business/:businessId', auth, promotionController.getAllByBusiness);
router.put('/:id', auth, promotionController.update);
router.delete('/:id', auth, promotionController.delete);

router.get('/business/:businessId/active', promotionController.getActiveByBusiness);

module.exports = router;
