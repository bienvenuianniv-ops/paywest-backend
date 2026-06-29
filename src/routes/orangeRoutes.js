const express = require('express');
const router = express.Router();
const { initiateOrangeDeposit, confirmOrangeDeposit, getOrangeDeposits } = require('../controllers/orangeController');
const { verifyToken } = require('../middleware/authMiddleware');

// POST /api/orange/deposit - Initier un dépôt Orange Money
router.post('/deposit', verifyToken, initiateOrangeDeposit);

// POST /api/orange/webhook - Webhook Orange Money (confirmation)
router.post('/webhook', confirmOrangeDeposit);

// GET /api/orange - Historique des dépôts Orange
router.get('/', verifyToken, getOrangeDeposits);

module.exports = router;