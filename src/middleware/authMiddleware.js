const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Accès refusé - Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    // Le role du JWT peut etre perime (suspension, changement de role) :
    // on revalide contre l'etat actuel en base a chaque requete.
    const result = await pool.query('SELECT role FROM users WHERE id = $1', [decoded.id]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Compte introuvable' });
    }
    if (result.rows[0].role === 'suspended') {
      return res.status(403).json({ message: 'Compte suspendu' });
    }

    req.user = { ...decoded, role: result.rows[0].role };
    next();
  } catch (error) {
    res.status(403).json({ message: 'Token invalide' });
  }
};

const verifyRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Accès refusé - Rôle insuffisant' });
    }
    next();
  };
};

module.exports = { verifyToken, verifyRole };