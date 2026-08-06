const express = require('express');
const router = express.Router();
const { sendMoney, getTransactions } = require('../controllers/transactionController');
const { verifyToken } = require('../middleware/authMiddleware');
const { transferRules, validate } = require('../middleware/validators');

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
 *       400:
 *         description: Solde insuffisant ou montant invalide
 *       404:
 *         description: Destinataire non trouvé
 */
router.post('/send', verifyToken, transferRules, validate, sendMoney);

/**
 * @swagger
 * /api/transactions:
 *   get:
 *     summary: Historique de toutes mes transactions
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 */
router.get('/', verifyToken, getTransactions);

module.exports = router;