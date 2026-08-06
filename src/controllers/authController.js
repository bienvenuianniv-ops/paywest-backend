const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendWelcome } = require('./notificationController');
const logger = require('../config/logger');

// Générer un refresh token aléatoire
const generateRefreshToken = () => crypto.randomBytes(40).toString('hex');

// INSCRIPTION
const register = async (req, res) => {
  const { full_name, email, phone, password } = req.body;
  const role = 'customer';

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existingUser = await client.query(
      'SELECT * FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Email ou téléphone déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await client.query(
      `INSERT INTO users (full_name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, phone, role`,
      [full_name, email, phone, hashedPassword, role]
    );

    const user = newUser.rows[0];

    await client.query(
      'INSERT INTO wallets (user_id) VALUES ($1)',
      [user.id]
    );

    await client.query('COMMIT');

    // Access token — courte durée
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Refresh token — longue durée
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );

    try {
      await sendWelcome(user.email, user.full_name);
    } catch (mailError) {
      console.error('Email de bienvenue non envoyé:', mailError.message);
    }

    logger.info('Nouvel utilisateur inscrit', { userId: user.id, email: user.email, role: user.role });

    res.status(201).json({ user, token, refresh_token: refreshToken });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Erreur inscription', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
  }
};

// CONNEXION
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn('Tentative de connexion échouée', { email });
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    // Access token — courte durée
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Refresh token — longue durée
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );

    logger.info('Connexion réussie', { userId: user.id, email: user.email, role: user.role });

    res.json({
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      token,
      refresh_token: refreshToken
    });

  } catch (error) {
    logger.error('Erreur connexion', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  }
};

// RENOUVELER LE TOKEN
const refreshToken = async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ message: 'Refresh token manquant' });
  }

  try {
    // Vérifier que le refresh token existe et n'est pas expiré
    const result = await pool.query(
      `SELECT rt.*, u.id as user_id, u.role, u.email, u.full_name, u.phone
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token = $1 AND rt.expires_at > NOW()`,
      [refresh_token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Refresh token invalide ou expiré' });
    }

    const userData = result.rows[0];

    // Générer un nouveau access token
    const newToken = jwt.sign(
      { id: userData.user_id, role: userData.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Générer un nouveau refresh token (rotation)
    const newRefreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Supprimer l'ancien et insérer le nouveau
    await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [userData.user_id, newRefreshToken, expiresAt]
    );

    logger.info('Token renouvelé', { userId: userData.user_id });

    res.json({
      token: newToken,
      refresh_token: newRefreshToken
    });

  } catch (error) {
    logger.error('Erreur refresh token', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// DÉCONNEXION
const logout = async (req, res) => {
  const { refresh_token } = req.body;

  try {
    if (refresh_token) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = $1', [refresh_token]);
    }

    logger.info('Déconnexion', { userId: req.user?.id });
    res.json({ message: 'Déconnecté avec succès' });

  } catch (error) {
    logger.error('Erreur déconnexion', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { register, login, refreshToken, logout };