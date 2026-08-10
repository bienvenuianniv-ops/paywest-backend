const rateLimit = require('express-rate-limit');

// Limite générale — toutes les routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requêtes max par IP
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Trop de requêtes, réessayez dans 15 minutes.' }
});

// Limite stricte — auth (login/register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives max
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Trop de tentatives de connexion, réessayez dans 15 minutes.' }
});

// Limite transactions — éviter le spam de transferts
const transactionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 transactions max par minute
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Trop de transactions, attendez 1 minute.' }
});

module.exports = { generalLimiter, authLimiter, transactionLimiter };