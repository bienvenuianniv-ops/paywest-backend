const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendWelcome } = require('./notificationController');
const logger = require('../config/logger');

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

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    try {
      await sendWelcome(user.email, user.full_name);
    } catch (mailError) {
      console.error('Email de bienvenue non envoyé:', mailError.message);
    }

    logger.info('Nouvel utilisateur inscrit', { userId: user.id, email: user.email, role: user.role });

    res.status(201).json({ user, token });

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

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
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
      token
    });

  } catch (error) {
    logger.error('Erreur connexion', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  }
};

module.exports = { register, login };