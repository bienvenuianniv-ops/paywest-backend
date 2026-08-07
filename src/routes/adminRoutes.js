const express = require('express');
const router = express.Router();
const { getAllUsers, getAllTransactions, getStats, updateUserRole } = require('../controllers/adminController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

const adminOnly = [verifyToken, verifyRole('admin')];

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Liste de tous les utilisateurs avec leurs wallets
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste complète des utilisateurs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/User'
 *                   - type: object
 *                     properties:
 *                       balance:
 *                         type: number
 *                         example: 48000
 *                       currency:
 *                         type: string
 *                         example: XOF
 *       403:
 *         description: Accès refusé — rôle admin requis
 */
router.get('/users', adminOnly, getAllUsers);

/**
 * @swagger
 * /api/admin/transactions:
 *   get:
 *     summary: Toutes les transactions de la plateforme
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste complète des transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 */
router.get('/transactions', adminOnly, getAllTransactions);

/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     summary: Statistiques globales de la plateforme
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques PayWest
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total_users:
 *                   type: integer
 *                   example: 9
 *                 total_transactions:
 *                   type: integer
 *                   example: 23
 *                 total_volume:
 *                   type: number
 *                   example: 89000
 *                 total_balance:
 *                   type: number
 *                   example: 48000
 */
router.get('/stats', adminOnly, getStats);

/**
 * @swagger
 * /api/admin/role:
 *   put:
 *     summary: Changer le rôle d'un utilisateur
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, role]
 *             properties:
 *               user_id:
 *                 type: integer
 *                 example: 2
 *               role:
 *                 type: string
 *                 enum: [customer, merchant, agent, admin]
 *                 example: merchant
 *     responses:
 *       200:
 *         description: Rôle mis à jour avec succès
 *       400:
 *         description: Rôle invalide
 *       404:
 *         description: Utilisateur non trouvé
 */
router.put('/role', adminOnly, updateUserRole);
const { getAllUsers, getAllTransactions, getStats, updateUserRole, suspendUser } = require('../controllers/adminController');

// DELETE /api/admin/users/:user_id/suspend
router.put('/users/:user_id/suspend', adminOnly, suspendUser);

module.exports = router;