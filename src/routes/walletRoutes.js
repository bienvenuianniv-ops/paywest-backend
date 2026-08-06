const express = require('express');
const router = express.Router();
const { getWallet, creditWallet } = require('../controllers/walletController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/wallet:
 *   get:
 *     summary: Consulter son solde
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Solde et informations du wallet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Wallet'
 *       401:
 *         description: Non authentifié
 */
router.get('/', verifyToken, getWallet);

/**
 * @swagger
 * /api/wallet/credit:
 *   post:
 *     summary: Recharger le wallet d'un utilisateur (admin/agent)
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, amount]
 *             properties:
 *               user_id:
 *                 type: integer
 *                 example: 2
 *               amount:
 *                 type: number
 *                 example: 10000
 *     responses:
 *       200:
 *         description: Wallet rechargé avec succès
 *       403:
 *         description: Accès refusé — rôle insuffisant
 */
router.post('/credit', verifyToken, verifyRole('admin', 'agent'), creditWallet);

module.exports = router;