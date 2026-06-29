const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendWelcome } = require('./notificationController');

// INSCRIPTION
const register = async (req, res) => {
  const { full_name, email, phone, password, role } = req.body;

  try {
    // Vérifier si l'utilisateur existe déjà
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Email ou téléphone déjà utilisé' });
    }

    // Chiffrer le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Créer l'utilisateur
    const newUser = await pool.query(
      `INSERT INTO users (full_name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, phone, role`,
      [full_name, email, phone, hashedPassword, role || 'customer']
    );

    const user = newUser.rows[0];

    // Créer le wallet automatiquement
    await pool.query(
      'INSERT INTO wallets (user_id) VALUES ($1)',
      [user.id]
    );

    // Générer le token JWT
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

// Envoyer email de bienvenue
await sendWelcome(user.email, user.full_name);

res.status(201).json({ user, token });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// CONNEXION
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Chercher l'utilisateur
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const user = result.rows[0];

    // Vérifier le mot de passe
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Mot de passe incorrect' });
    }

    // Générer le token JWT
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

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
    res.status(500).json({ message: error.message });
  }
};

module.exports = { register, login };