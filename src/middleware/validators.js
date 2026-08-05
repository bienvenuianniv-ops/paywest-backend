const { body, validationResult } = require('express-validator');

// Middleware pour vérifier les erreurs de validation
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Données invalides',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

// Règles de validation — Inscription
const registerRules = [
  body('full_name')
    .trim()
    .notEmpty().withMessage('Le nom complet est obligatoire')
    .isLength({ min: 2, max: 100 }).withMessage('Le nom doit avoir entre 2 et 100 caractères'),

  body('email')
    .trim()
    .notEmpty().withMessage('L\'email est obligatoire')
    .isEmail().withMessage('Email invalide')
    .normalizeEmail(),

  body('phone')
    .trim()
    .notEmpty().withMessage('Le téléphone est obligatoire')
    .matches(/^\+?[0-9]{8,15}$/).withMessage('Numéro de téléphone invalide'),

  body('password')
    .notEmpty().withMessage('Le mot de passe est obligatoire')
    .isLength({ min: 6 }).withMessage('Le mot de passe doit avoir au moins 6 caractères')
];

// Règles de validation — Connexion
const loginRules = [
  body('email')
    .trim()
    .notEmpty().withMessage('L\'email est obligatoire')
    .isEmail().withMessage('Email invalide'),

  body('password')
    .notEmpty().withMessage('Le mot de passe est obligatoire')
];

// Règles de validation — Transfert
const transferRules = [
  body('receiver_phone')
    .trim()
    .notEmpty().withMessage('Le numéro du destinataire est obligatoire')
    .matches(/^\+?[0-9]{8,15}$/).withMessage('Numéro de téléphone invalide'),

  body('amount')
    .notEmpty().withMessage('Le montant est obligatoire')
    .isInt({ min: 1 }).withMessage('Le montant doit être un entier positif')
];

// Règles de validation — Dépôt
const depositRules = [
  body('amount')
    .notEmpty().withMessage('Le montant est obligatoire')
    .isInt({ min: 100 }).withMessage('Le montant minimum est 100 XOF'),

  body('phone')
    .trim()
    .notEmpty().withMessage('Le numéro Mobile Money est obligatoire')
    .matches(/^\+?[0-9]{8,15}$/).withMessage('Numéro de téléphone invalide')
];

module.exports = { validate, registerRules, loginRules, transferRules, depositRules };