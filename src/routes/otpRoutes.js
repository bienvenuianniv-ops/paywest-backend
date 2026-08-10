const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { validate, resendOtpRules } = require('../middleware/validators');
const { resendOtp } = require('../controllers/otpController');

/**
 * @swagger
 * /api/otp/resend:
 *   post:
 *     summary: Renvoyer un code OTP par SMS pour une transaction en attente
 *     tags: [OTP]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [purpose, amount]
 *             properties:
 *               purpose:
 *                 type: string
 *                 enum: [transactions.send, withdraw.wave, withdraw.orange]
 *               amount:
 *                 type: integer
 *               receiver_phone:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nouveau code envoyé
 *       400:
 *         description: Motif ou montant invalide
 *       404:
 *         description: Aucun code en attente pour cette transaction
 *       429:
 *         description: Cooldown actif
 *       502:
 *         description: Échec de l'envoi du SMS
 */
router.post('/resend', verifyToken, resendOtpRules, validate, resendOtp);

module.exports = router;
