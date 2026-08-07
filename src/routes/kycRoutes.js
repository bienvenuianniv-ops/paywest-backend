const express = require('express');
const router = express.Router();
const { submitKYC, getKYCStatus, reviewKYC, getAllKYC } = require('../controllers/kycController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/kyc/submit:
 *   post:
 *     summary: Soumettre une demande de vérification d'identité
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [document_type, document_number, full_name, date_of_birth, nationality]
 *             properties:
 *               document_type:
 *                 type: string
 *                 enum: [CNI, passeport, permis]
 *                 example: CNI
 *               document_number:
 *                 type: string
 *                 example: "1234567890"
 *               full_name:
 *                 type: string
 *                 example: Bienvenu Ianniv
 *               date_of_birth:
 *                 type: string
 *                 example: "1990-01-01"
 *               nationality:
 *                 type: string
 *                 example: Congolaise
 *     responses:
 *       201:
 *         description: Demande KYC soumise avec succès
 *       400:
 *         description: KYC déjà soumis ou approuvé
 */
router.post('/submit', verifyToken, submitKYC);

/**
 * @swagger
 * /api/kyc/status:
 *   get:
 *     summary: Consulter son statut KYC
 *     tags: [Authentification]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statut KYC de l'utilisateur
 */
router.get('/status', verifyToken, getKYCStatus);

/**
 * @swagger
 * /api/kyc/review:
 *   put:
 *     summary: Approuver ou rejeter un KYC (admin uniquement)
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kyc_id, status]
 *             properties:
 *               kyc_id:
 *                 type: integer
 *                 example: 1
 *               status:
 *                 type: string
 *                 enum: [approved, rejected]
 *               rejection_reason:
 *                 type: string
 *                 example: Document illisible
 *     responses:
 *       200:
 *         description: KYC approuvé ou rejeté
 */
router.put('/review', verifyToken, verifyRole('admin'), reviewKYC);

/**
 * @swagger
 * /api/kyc:
 *   get:
 *     summary: Liste toutes les demandes KYC (admin uniquement)
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *     responses:
 *       200:
 *         description: Liste des demandes KYC
 */
router.get('/', verifyToken, verifyRole('admin'), getAllKYC);

module.exports = router;