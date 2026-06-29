const express = require('express');
const router = express.Router();
const { getWallet, creditWallet } = require('../controllers/walletController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

// GET /api/wallet - Consulter son solde (tous les rôles)
router.get('/', verifyToken, getWallet);

// POST /api/wallet/credit - Recharger un wallet (admin/agent uniquement)
router.post('/credit', verifyToken, verifyRole('admin', 'agent'), creditWallet);

module.exports = router;