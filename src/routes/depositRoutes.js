const express = require('express');
const router = express.Router();
const { initiateWaveDeposit, confirmWaveDeposit, getDeposits } = require('../controllers/depositController');
const { verifyToken } = require('../middleware/authMiddleware');
const { depositRules, validate } = require('../middleware/validators');

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
 *                 description: Montant minimum 100 XOF
 *               phone:
 *                 type: string
 *                 example: "+221771234567"
 *                 description: Numéro Wave
 *     responses:
 *       200:
 *         description: Lien de paiement Wave généré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Dépôt initié avec succès
 *                 reference:
 *                   type: string
 *                   example: PAY-1782756166635-GRL7OC
 *                 payment_url:
 *                   type: string
 *                   example: https://pay.wave.com/m/paywest?amount=10000
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
 *       400:
 *         description: Paiement non complété ou déjà traité
 */
router.post('/webhook', confirmWaveDeposit);

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
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 */
router.get('/', verifyToken, getDeposits);

module.exports = router;