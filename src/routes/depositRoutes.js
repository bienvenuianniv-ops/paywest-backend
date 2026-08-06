const express = require('express');
const router = express.Router();
const { initiateWaveDeposit, confirmWaveDeposit, getDeposits } = require('../controllers/depositController');
const { verifyToken } = require('../middleware/authMiddleware');
const { depositRules, validate } = require('../middleware/validators');
const { verifyWaveWebhook } = require('../middleware/webhookSecurity');

/**
 * @swagger
 * /api/deposit/wave:
 *   post:
 *     summary: Initier un dépôt via Wave
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
 *                 example: 10000
 *               phone:
 *                 type: string
 *                 example: "+221771234567"
 *     responses:
 *       200:
 *         description: Lien de paiement Wave généré
 *       400:
 *         description: Montant invalide
 */
router.post('/wave', verifyToken, depositRules, validate, initiateWaveDeposit);

/**
 * @swagger
 * /api/deposit/webhook:
 *   post:
 *     summary: Webhook Wave — confirmer un dépôt après paiement
 *     tags: [Dépôts]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reference, transaction_id, status]
 *             properties:
 *               reference:
 *                 type: string
 *                 example: PAY-1782756166635-GRL7OC
 *               transaction_id:
 *                 type: integer
 *                 example: 9
 *               status:
 *                 type: string
 *                 example: completed
 *     responses:
 *       200:
 *         description: Dépôt confirmé et wallet crédité
 *       401:
 *         description: Signature invalide
 */
router.post('/webhook', verifyWaveWebhook, confirmWaveDeposit);

/**
 * @swagger
 * /api/deposit:
 *   get:
 *     summary: Historique de mes dépôts
 *     tags: [Dépôts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des dépôts
 */
router.get('/', verifyToken, getDeposits);

module.exports = router;