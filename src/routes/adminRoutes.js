const express = require('express');
const router = express.Router();
const { getAllUsers, getAllTransactions, getStats, updateUserRole, suspendUser } = require('../controllers/adminController');
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
 *         description: Liste complète des utilisateurs paginée
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
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [transfer, credit, payment, deposit, withdraw]
 *         description: Filtrer par type
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed]
 *         description: Filtrer par statut
 *     responses:
 *       200:
 *         description: Liste complète des transactions paginée
 */
router.get('/transactions', adminOnly, getAllTransactions);

/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     summary: Statistiques globales avancées de la plateforme
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques PayWest complètes
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

/**
 * @swagger
 * /api/admin/users/{user_id}/suspend:
 *   put:
 *     summary: Suspendre un utilisateur
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: user_id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 2
 *     responses:
 *       200:
 *         description: Utilisateur suspendu avec succès
 *       404:
 *         description: Utilisateur non trouvé
 */
router.put('/users/:user_id/suspend', adminOnly, suspendUser);

module.exports = router;
