const express = require('express');
const router = express.Router();
const { exportTransactionsExcel, getFinancialSummary } = require('../controllers/reportController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

const adminOnly = [verifyToken, verifyRole('admin')];

/**
 * @swagger
 * /api/reports/export:
 *   get:
 *     summary: Exporter les transactions en Excel
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *         example: "2026-01-01"
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *         example: "2026-12-31"
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [transfer, credit, payment, deposit, withdraw]
 *     responses:
 *       200:
 *         description: Fichier Excel téléchargeable
 */
router.get('/export', adminOnly, exportTransactionsExcel);

/**
 * @swagger
 * /api/reports/summary:
 *   get:
 *     summary: Résumé financier mensuel
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *         example: 8
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         example: 2026
 *     responses:
 *       200:
 *         description: Résumé financier du mois
 */
router.get('/summary', adminOnly, getFinancialSummary);

module.exports = router;