const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');
const { registerRules, loginRules, validate } = require('../middleware/validators');
const { register, login, refreshToken, logout } = require('../controllers/authController');

// POST /api/auth/refresh - Renouveler le token
router.post('/refresh', refreshToken);

// POST /api/auth/logout - Déconnexion
router.post('/logout', logout);

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Créer un nouveau compte
 *     tags: [Authentification]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [full_name, email, phone, password]
 *             properties:
 *               full_name:
 *                 type: string
 *                 example: Bienvenu Ianniv
 *               email:
 *                 type: string
 *                 example: bienvenu@paywest.com
 *               phone:
 *                 type: string
 *                 example: "+221771234567"
 *               password:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       201:
 *         description: Compte créé avec succès
 *       400:
 *         description: Email ou téléphone déjà utilisé
 */
router.post('/register', registerRules, validate, register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Se connecter à PayWest
 *     tags: [Authentification]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 example: bienvenu@paywest.com
 *               password:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Connexion réussie — retourne le token JWT
 *       401:
 *         description: Email ou mot de passe incorrect
 */
router.post('/login', loginRules, validate, login);

module.exports = router;