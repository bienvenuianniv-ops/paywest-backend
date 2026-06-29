const express = require('express');
const router = express.Router();
const { sendMoney, getTransactions } = require('../controllers/transactionController');
const { verifyToken } = require('../middleware/authMiddleware');

// POST /api/transactions/send - Envoyer de l'argent
router.post('/send', verifyToken, sendMoney);

// GET /api/transactions - Historique des transactions
router.get('/', verifyToken, getTransactions);

module.exports = router;