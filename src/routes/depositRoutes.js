const express = require('express');
const router = express.Router();
const { initiateWaveDeposit, confirmWaveDeposit, getDeposits } = require('../controllers/depositController');
const { verifyToken } = require('../middleware/authMiddleware');

// POST /api/deposit/wave - Initier un dépôt Wave
router.post('/wave', verifyToken, initiateWaveDeposit);

// POST /api/deposit/webhook - Webhook Wave (confirmation)
router.post('/webhook', confirmWaveDeposit);

// GET /api/deposit - Historique des dépôts
router.get('/', verifyToken, getDeposits);

module.exports = router;