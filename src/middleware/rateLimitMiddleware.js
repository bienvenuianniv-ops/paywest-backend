const rateLimit = require('express-rate-limit');

// Limiteur strict pour l'authentification (login/register) :
// peu de tentatives, fenêtre courte, pour freiner le brute force
// sur les mots de passe sans gêner un utilisateur normal.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives par IP sur la fenêtre
  message: { message: 'Trop de tentatives, réessaie dans quelques minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiteur général pour le reste de l'API : protection contre un
// abus massif (script qui boucle, DoS basique), sans gêner un usage normal.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requêtes par IP sur la fenêtre
  message: { message: 'Trop de requêtes, réessaie dans quelques minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, generalLimiter };