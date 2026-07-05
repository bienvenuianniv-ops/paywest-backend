const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendWelcome } = require('./notificationController');

// INSCRIPTION
const register = async (req, res) => {
  // Le rôle n'est JAMAIS lu depuis req.body : on ne fait pas confiance au client
  // pour décider de ses propres privilèges. Toute inscription publique est 'customer'.
  const { full_name, email, phone, password } = req.body;
  const role = 'customer';

  // Un seul client dédié : la création du user et de son wallet doit être
  // tout ou rien, sinon un échec partiel laisse un compte sans wallet.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await client.query(
      'SELECT * FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Email ou téléphone déjà utilisé' });
    }

    // Chiffrer le mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Créer l'utilisateur
    const newUser = await client.query(
      `INSERT INTO users (full_name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, full_name, email, phone, role`,
      [full_name, email, phone, hashedPassword, role]
    );

    const user = newUser.rows[0];

    // Créer le wallet automatiquement
    await client.query(
      'INSERT INTO wallets (user_id) VALUES ($1)',
      [user.id]
    );

    await client.query('COMMIT');

    // Générer le token JWT
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // La notification part APRES le commit : un email qui échoue ne doit
    // jamais faire annuler la création du compte déjà validée.
    try {
      await sendWelcome(user.email, user.full_name);
    } catch (mailError) {
      console.error('Email de bienvenue non envoyé:', mailError.message);
    }

    res.status(201).json({ user, token });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur inscription:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
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
      // Message volontairement identique à celui du mauvais mot de passe :
      // on ne révèle jamais si un email existe en base ou non.
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
    }

    const user = result.rows[0];

    // Vérifier le mot de passe
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
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
    console.error('Erreur connexion:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  }
};

module.exports = { register, login };