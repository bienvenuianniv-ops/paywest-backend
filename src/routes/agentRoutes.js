const express = require('express');
const router = express.Router();
const { creditClient, withdrawClient, getAgentHistory } = require('../controllers/agentController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

// Seuls les agents et admins peuvent accéder
const agentOnly = [verifyToken, verifyRole('agent', 'admin')];

// POST /api/agent/credit - Recharger le wallet d'un client
router.post('/credit', agentOnly, creditClient);

// POST /api/agent/withdraw - Retrait pour un client
router.post('/withdraw', agentOnly, withdrawClient);

// GET /api/agent/history - Historique des opérations
router.get('/history', agentOnly, getAgentHistory);

module.exports = router;