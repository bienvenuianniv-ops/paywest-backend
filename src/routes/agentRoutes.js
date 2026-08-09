const express = require('express');
const router = express.Router();
const { creditClient, withdrawClient, getAgentHistory } = require('../controllers/agentController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');
const { checkTransactionLimits } = require('../middleware/transactionLimits');
const { idempotency } = require('../middleware/idempotency');

const agentOnly = [verifyToken, verifyRole('agent', 'admin')];

/**
 * @swagger
 * /api/agent/credit:
 *   post:
 *     summary: Recharger le wallet d'un client en cash
 *     tags: [Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_phone, amount]
 *             properties:
 *               client_phone:
 *                 type: string
 *                 example: "+221770000001"
 *               amount:
 *                 type: integer
 *                 example: 5000
 *     responses:
 *       200:
 *         description: Wallet rechargé avec succès
 *       404:
 *         description: Client non trouvé
 *       403:
 *         description: Accès refusé — rôle agent ou admin requis
 */
router.post('/credit', agentOnly, idempotency('agent.credit'), checkTransactionLimits, creditClient);

/**
 * @swagger
 * /api/agent/withdraw:
 *   post:
 *     summary: Effectuer un retrait cash pour un client
 *     tags: [Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [client_phone, amount]
 *             properties:
 *               client_phone:
 *                 type: string
 *                 example: "+221770000001"
 *               amount:
 *                 type: integer
 *                 example: 2000
 *     responses:
 *       200:
 *         description: Retrait effectué avec succès
 *       400:
 *         description: Solde client insuffisant
 *       404:
 *         description: Client non trouvé
 */
router.post('/withdraw', agentOnly, idempotency('agent.withdraw'), checkTransactionLimits, withdrawClient);

/**
 * @swagger
 * /api/agent/history:
 *   get:
 *     summary: Historique des opérations de l'agent
 *     tags: [Agent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des opérations effectuées
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 */
router.get('/history', agentOnly, getAgentHistory);

module.exports = router;