const express = require('express');
const router = express.Router();
const { generateQRCode, payViaQR } = require('../controllers/merchantController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

// GET /api/merchant/qrcode - Générer un QR code (merchant/admin)
router.get('/qrcode', verifyToken, verifyRole('merchant', 'admin'), generateQRCode);

// POST /api/merchant/pay - Payer via QR code (tous les rôles)
router.post('/pay', verifyToken, payViaQR);

module.exports = router;