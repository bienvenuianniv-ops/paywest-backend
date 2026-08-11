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

// Limite décaissement — indexée sur l'utilisateur, pas sur l'IP.
//
// Deux raisons de ne pas réutiliser transactionLimiter ici. D'abord la menace
// visée : un jeton admin volé qui déclenche un SMS par montant distinct
// (/api/admin/payout n'a pas de seuil OTP). Une limite par IP ne l'arrête pas
// — l'attaquant change d'IP — alors qu'une limite par utilisateur suit le
// jeton. Ensuite la disponibilité : transactionLimiter est une instance
// unique, avec un seul compteur en mémoire, déjà montée sur /api/transactions,
// /api/otp, /api/withdraw et /api/agent. Un admin derrière un NAT partagé peut
// donc se voir refuser un décaissement parce que des clients sans aucun
// rapport ont consommé le budget de son IP.
//
// Monté après adminOnly : req.user est toujours défini.
const payoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  skip: skipInTests,
  keyGenerator: (req) => String(req.user.id),
  // La clé ne contient aucune adresse IP : la validation intégrée qui vérifie
  // la normalisation IPv6 des clés n'a pas d'objet ici.
  validate: { keyGeneratorIpFallback: false },
  message: { message: 'Trop de décaissements, attendez 1 minute.' }
});

module.exports = { generalLimiter, authLimiter, transactionLimiter, payoutLimiter };