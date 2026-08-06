const express = require('express');
const router = express.Router();
const { generateQRCode, payViaQR } = require('../controllers/merchantController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/merchant/qrcode:
 *   get:
 *     summary: Générer un QR code de paiement
 *     tags: [Marchand]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR code généré avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: QR code généré avec succès
 *                 qr_data:
 *                   type: object
 *                   properties:
 *                     merchant_id:
 *                       type: integer
 *                       example: 1
 *                     merchant_name:
 *                       type: string
 *                       example: Bienvenu Ianniv
 *                     phone:
 *                       type: string
 *                       example: "+221771234567"
 *                     qr_code:
 *                       type: string
 *                       example: "a1b2c3d4e5f6..."
 *                 payment_url:
 *                   type: string
 *                   example: "https://paywest.mayouservice.com/pay?merchant=1&code=a1b2c3d4"
 *       403:
 *         description: Accès refusé — rôle merchant ou admin requis
 */
router.get('/qrcode', verifyToken, verifyRole('merchant', 'admin'), generateQRCode);

/**
 * @swagger
 * /api/merchant/pay:
 *   post:
 *     summary: Payer un marchand via QR code
 *     tags: [Marchand]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [merchant_id, qr_code, amount]
 *             properties:
 *               merchant_id:
 *                 type: integer
 *                 example: 1
 *               qr_code:
 *                 type: string
 *                 example: "a1b2c3d4e5f6..."
 *               amount:
 *                 type: integer
 *                 example: 3000
 *     responses:
 *       200:
 *         description: Paiement effectué avec succès
 *       400:
 *         description: Solde insuffisant ou montant invalide
 *       404:
 *         description: Marchand non trouvé
 */
router.post('/pay', verifyToken, payViaQR);

module.exports = router;