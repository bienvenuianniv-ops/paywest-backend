const express = require('express');
const router = express.Router();
const { withdrawToWave, withdrawToOrange, confirmWithdraw, getWithdrawals } = require('../controllers/withdrawController');
const { verifyToken } = require('../middleware/authMiddleware');
const { depositRules, validate } = require('../middleware/validators');
const { checkTransactionLimits } = require('../middleware/transactionLimits');
const { verifyWaveWebhook, verifyOrangeWebhook } = require('../middleware/webhookSecurity');

/**
 * @swagger
 * /api/withdraw/wave:
 *   post:
 *     summary: Retirer des fonds vers Wave
 *     tags: [Dépôts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, phone]
 *             properties:
 *               amount:
 *                 type: integer
 *                 example: 5000
 *               phone:
 *                 type: string
 *                 example: "+221771234567"
 *     responses:
 *       200:
 *         description: Retrait Wave initié
 *       400:
 *         description: Solde insuffisant
 */
router.post('/wave', verifyToken, depositRules, validate, checkTransactionLimits, withdrawToWave);

/**
 * @swagger
 * /api/withdraw/orange:
 *   post:
 *     summary: Retirer des fonds vers Orange Money
 *     tags: [Dépôts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, phone]
 *             properties:
 *               amount:
 *                 type: integer
 *                 example: 5000
 *               phone:
 *                 type: string
 *                 example: "+221771234567"
 *     responses:
 *       200:
 *         description: Retrait Orange Money initié
 *       400:
 *         description: Solde insuffisant
 */
router.post('/orange', verifyToken, depositRules, validate, checkTransactionLimits, withdrawToOrange);

/**
 * @swagger
 * /api/withdraw/webhook/wave:
 *   post:
 *     summary: Webhook Wave — confirmer ou annuler un retrait
 *     tags: [Dépôts]
 *     security: []
 *     responses:
 *       200:
 *         description: Retrait confirmé ou remboursé
 */
router.post('/webhook/wave', verifyWaveWebhook, confirmWithdraw);

/**
 * @swagger
 * /api/withdraw/webhook/orange:
 *   post:
 *     summary: Webhook Orange Money — confirmer ou annuler un retrait
 *     tags: [Dépôts]
 *     security: []
 *     responses:
 *       200:
 *         description: Retrait confirmé ou remboursé
 */
router.post('/webhook/orange', verifyOrangeWebhook, confirmWithdraw);

/**
 * @swagger
 * /api/withdraw:
 *   get:
 *     summary: Historique de mes retraits
 *     tags: [Dépôts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des retraits
 */
router.get('/', verifyToken, getWithdrawals);

module.exports = router;