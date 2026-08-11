const express = require('express');
const router = express.Router();
const { getAllUsers, getAllTransactions, getStats, updateUserRole, suspendUser } = require('../controllers/adminController');
const { getPlatformBalance, validatePayoutAmount, createPayout } = require('../controllers/payoutController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');
const auditLog = require('../middleware/auditLog');
const { idempotency } = require('../middleware/idempotency');
const { requireOtp } = require('../middleware/requireOtp');
const { transactionLimiter } = require('../middleware/rateLimiter');
const pool = require('../config/db');

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
router.get('/users', adminOnly, auditLog('admin_list_users'), getAllUsers);

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
router.get('/transactions', adminOnly, auditLog('admin_list_transactions'), getAllTransactions);

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
router.get('/stats', adminOnly, auditLog('admin_view_stats'), getStats);

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
router.put('/role', adminOnly, auditLog('admin_change_role'), updateUserRole);

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
router.put('/users/:user_id/suspend', adminOnly, auditLog('admin_suspend_user'), suspendUser);

/**
 * @swagger
 * /api/admin/audit:
 *   get:
 *     summary: Historique d'audit des actions admin
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Liste des 100 dernières actions admin
 */
router.get('/audit', adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, u.email, u.full_name
       FROM audit_logs a
       JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

/**
 * @swagger
 * /api/admin/platform-balance:
 *   get:
 *     summary: Solde du wallet plateforme (revenus de frais accumulés)
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Solde courant du compte plateforme
 *       403:
 *         description: Accès refusé — rôle admin requis
 */
router.get(
  '/platform-balance',
  adminOnly,
  auditLog('admin_view_platform_balance'),
  getPlatformBalance
);

// Ordre : transactionLimiter d'abord (cette route est la seule route admin a
// envoyer un SMS facture par requete — l'OTP admin.payout n'a pas de seuil,
// donc amount = 1, 2, 3... genere un SMS chacun ; sans limiteur ici, un jeton
// admin vole permet de bombarder de SMS le telephone de l'admin, le
// generalLimiter de /api ne bornant qu'a 100 requetes/15 min/IP). Puis
// idempotency avant auditLog : idempotency renvoie une reponse en cache sur
// rejeu via res.json, deja l'enveloppe posee par auditLog — si auditLog
// s'enregistrait en premier, un rejeu ecrirait une seconde ligne d'audit a
// 200 alors qu'aucun argent n'a bouge. L'OTP reste la derniere porte avant le
// controleur. checkTransactionLimits n'est volontairement PAS applique : les
// plafonds BCEAO encadrent les transferts clients, un mouvement interne de
// tresorerie n'entre pas dans leurs sommes.
/**
 * @swagger
 * /api/admin/payout:
 *   post:
 *     summary: Décaisser les revenus du wallet plateforme
 *     description: >
 *       Transfert interne du wallet plateforme vers un compte PayWest fixe,
 *       résolu côté serveur par la variable d'environnement
 *       PAYOUT_DESTINATION_EMAIL — la destination n'est jamais lue dans la
 *       requête. Un code OTP envoyé par SMS est exigé quel que soit le montant.
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         description: Optionnel — protège d'un double envoi
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: integer
 *                 example: 50000
 *               otp_code:
 *                 type: string
 *                 example: "123456"
 *                 description: Absent au premier appel — déclenche l'envoi du code
 *     responses:
 *       200:
 *         description: Décaissement effectué
 *       400:
 *         description: Montant invalide ou solde plateforme insuffisant
 *       401:
 *         description: Code OTP invalide ou expiré
 *       403:
 *         description: Rôle admin requis, ou code OTP exigé
 *       409:
 *         description: Requête identique déjà en cours de traitement
 *       500:
 *         description: Compte de destination non configuré
 *       502:
 *         description: Échec de l'envoi du SMS
 */
router.post(
  '/payout',
  adminOnly,
  transactionLimiter,
  idempotency('admin.payout'),
  auditLog('admin_payout'),
  validatePayoutAmount,
  requireOtp('admin.payout'),
  createPayout
);

module.exports = router;
