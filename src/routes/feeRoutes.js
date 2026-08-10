const express = require('express');
const router = express.Router();
const { getFeeGrid, getQuote } = require('../controllers/feeController');
const { verifyToken } = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/fees:
 *   get:
 *     summary: Consulter la grille tarifaire des transferts
 *     tags: [Frais]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Grille des paliers de frais
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currency:
 *                   type: string
 *                   example: XOF
 *                 tiers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       min:
 *                         type: integer
 *                         example: 5001
 *                       max:
 *                         type: integer
 *                         nullable: true
 *                         description: null pour le dernier palier (sans limite haute)
 *                         example: 25000
 *                       fee:
 *                         type: integer
 *                         example: 250
 *       401:
 *         description: Non authentifié
 */
router.get('/', verifyToken, getFeeGrid);

/**
 * @swagger
 * /api/fees/quote:
 *   get:
 *     summary: Chiffrer les frais d'un transfert avant confirmation
 *     tags: [Frais]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: amount
 *         required: true
 *         schema:
 *           type: integer
 *           example: 50000
 *     responses:
 *       200:
 *         description: Montant, frais, débit total et somme reçue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 amount:
 *                   type: integer
 *                   example: 50000
 *                 fee:
 *                   type: integer
 *                   example: 500
 *                 total_debit:
 *                   type: integer
 *                   description: Somme débitée de l'expéditeur (montant + frais)
 *                   example: 50500
 *                 receiver_gets:
 *                   type: integer
 *                   description: Somme reçue par le destinataire
 *                   example: 50000
 *       400:
 *         description: Montant invalide
 *       401:
 *         description: Non authentifié
 */
router.get('/quote', verifyToken, getQuote);

module.exports = router;
