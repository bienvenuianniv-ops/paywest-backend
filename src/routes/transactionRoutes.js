const express = require('express');
const router = express.Router();
const { sendMoney, getTransactions } = require('../controllers/transactionController');
const { verifyToken } = require('../middleware/authMiddleware');
const { transferRules, validate } = require('../middleware/validators');
const { checkTransactionLimits } = require('../middleware/transactionLimits');
const { idempotency } = require('../middleware/idempotency');
const { requireOtp } = require('../middleware/requireOtp');

/**
 * @swagger
 * /api/transactions/send:
 *   post:
 *     summary: Envoyer de l'argent à un autre utilisateur
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receiver_phone, amount]
 *             properties:
 *               receiver_phone:
 *                 type: string
 *                 example: "+221770000001"
 *               amount:
 *                 type: integer
 *                 example: 5000
 *     responses:
 *       200:
 *         description: Transfert effectué avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Transfert effectué avec succès
 *                 fee:
 *                   type: integer
 *                   description: Frais prélevés en sus du montant, à la charge de l'expéditeur
 *                   example: 250
 *                 total_debit:
 *                   type: integer
 *                   description: Somme réellement débitée de l'expéditeur (montant + frais)
 *                   example: 10250
 *       400:
 *         description: Solde insuffisant (montant + frais), montant invalide ou limite dépassée
 *       403:
 *         description: Code OTP requis (montant supérieur à 100 000 XOF)
 *       404:
 *         description: Destinataire non trouvé
 */
router.post('/send', verifyToken, idempotency('transactions.send'), transferRules, validate, checkTransactionLimits, requireOtp('transactions.send'), sendMoney);

/**
 * @swagger
 * /api/transactions:
 *   get:
 *     summary: Historique de toutes mes transactions
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         example: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         example: 20
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Liste paginée des transactions
 */
router.get('/', verifyToken, getTransactions);

module.exports = router;