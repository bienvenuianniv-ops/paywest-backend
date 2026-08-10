const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');

// Les limiteurs sont neutralises en test (une suite d'integration enchaine
// bien plus de requetes qu'un utilisateur reel). Le risque est qu'un
// environnement demarre par erreur avec NODE_ENV=test tourne alors sans
// aucune protection contre le brute-force du login ni le spam de
// transactions — silencieusement. On le rend bruyant au demarrage.
const rateLimitDisabled = process.env.NODE_ENV === 'test';

if (rateLimitDisabled) {
  logger.warn('⚠️  RATE LIMITING DÉSACTIVÉ (NODE_ENV=test) — aucune protection brute-force ni anti-spam active');
}

const skipInTests = () => rateLimitDisabled;

// Limite générale — toutes les routes
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requêtes max par IP
  skip: skipInTests,
  message: { message: 'Trop de requêtes, réessayez dans 15 minutes.' }
});

// Limite stricte — auth (login/register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 tentatives max
  skip: skipInTests,
  message: { message: 'Trop de tentatives de connexion, réessayez dans 15 minutes.' }
});

// Limite transactions — éviter le spam de transferts
const transactionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 transactions max par minute
  skip: skipInTests,
  message: { message: 'Trop de transactions, attendez 1 minute.' }
});

module.exports = { generalLimiter, authLimiter, transactionLimiter };