const express = require('express');
const router = express.Router();
const { getAllUsers, getAllTransactions, getStats, updateUserRole } = require('../controllers/adminController');
const { verifyToken, verifyRole } = require('../middleware/authMiddleware');

// Toutes les routes admin sont protégées
const adminOnly = [verifyToken, verifyRole('admin')];

// GET /api/admin/users - Tous les utilisateurs
router.get('/users', adminOnly, getAllUsers);

// GET /api/admin/transactions - Toutes les transactions
router.get('/transactions', adminOnly, getAllTransactions);

// GET /api/admin/stats - Statistiques globales
router.get('/stats', adminOnly, getStats);

// PUT /api/admin/role - Changer le rôle d'un utilisateur
router.put('/role', adminOnly, updateUserRole);

module.exports = router;