const express = require('express');
const router = express.Router();
const { initiateOrangeDeposit, confirmOrangeDeposit, getOrangeDeposits } = require('../controllers/orangeController');
const { verifyToken } = require('../middleware/authMiddleware');
const { depositRules, validate } = require('../middleware/validators');
const { verifyOrangeWebhook } = require('../middleware/webhookSecurity');

/**
 * @swagger
 * /api/orange/deposit:
 *   post:
 *     summary: Initier un dépôt via Orange Money
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
 *         description: Lien de paiement Orange Money généré
 *       400:
 *         description: Montant invalide
 */
router.post('/deposit', verifyToken, depositRules, validate, initiateOrangeDeposit);

/**
 * @swagger
 * /api/orange/webhook:
 *   post:
 *     summary: Webhook Orange Money — confirmer un dépôt
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
 *                 example: OM-1782757145522-88C1Z6
 *               transaction_id:
 *                 type: integer
 *                 example: 10
 *               status:
 *                 type: string
 *                 example: completed
 *     responses:
 *       200:
 *         description: Dépôt Orange Money confirmé
 *       401:
 *         description: Signature invalide
 */
router.post('/webhook', verifyOrangeWebhook, confirmOrangeDeposit);

/**
 * @swagger
 * /api/orange:
 *   get:
 *     summary: Historique des dépôts Orange Money
 *     tags: [Dépôts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des dépôts Orange Money
 */
router.get('/', verifyToken, getOrangeDeposits);

module.exports = router;