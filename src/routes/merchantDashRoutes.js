const express = require('express');
const router = express.Router();
const { getMerchantStats } = require('../controllers/merchantDashController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

// GET /api/merchant-dash - Tableau de bord marchand
router.get('/', verifyToken, verifyRole('merchant', 'admin'), getMerchantStats);

module.exports = router;