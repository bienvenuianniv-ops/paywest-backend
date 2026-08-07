const express = require('express');
const router = express.Router();
const { getRates, convertAmount, updateRate } = require('../controllers/currencyController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/currency/rates:
 *   get:
 *     summary: Récupérer tous les taux de change
 *     tags: [Transactions]
 *     security: []
 *     responses:
 *       200:
 *         description: Liste des taux de change disponibles
 */
router.get('/rates', getRates);

/**
 * @swagger
 * /api/currency/convert:
 *   post:
 *     summary: Convertir un montant d'une devise à une autre
 *     tags: [Transactions]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, from_currency, to_currency]
 *             properties:
 *               amount:
 *                 type: integer
 *                 example: 10000
 *               from_currency:
 *                 type: string
 *                 example: XOF
 *               to_currency:
 *                 type: string
 *                 example: EUR
 *     responses:
 *       200:
 *         description: Résultat de la conversion avec frais
 *       404:
 *         description: Taux de change non disponible
 */
router.post('/convert', convertAmount);

/**
 * @swagger
 * /api/currency/rates/update:
 *   put:
 *     summary: Mettre à jour un taux de change (admin uniquement)
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from_currency, to_currency, rate, fee_percent]
 *             properties:
 *               from_currency:
 *                 type: string
 *                 example: XOF
 *               to_currency:
 *                 type: string
 *                 example: EUR
 *               rate:
 *                 type: number
 *                 example: 0.001524
 *               fee_percent:
 *                 type: number
 *                 example: 1.5
 *     responses:
 *       200:
 *         description: Taux mis à jour avec succès
 */
router.put('/rates/update', verifyToken, verifyRole('admin'), updateRate);

module.exports = router;