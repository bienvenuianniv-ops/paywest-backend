const pool = require('../config/db');
const logger = require('../config/logger');
const {
  computeBindingHash,
  generateAndSendOtp,
  isValidPurpose,
  RESEND_COOLDOWN_MS
} = require('../middleware/requireOtp');

// In-memory tracking of resend attempts per user+purpose+binding
// Maps "userId:purpose:bindingHash" to last resend call timestamp
const resendCallTimes = {};

const resendOtp = async (req, res) => {
  const { purpose, amount } = req.body;

  if (!isValidPurpose(purpose)) {
    return res.status(400).json({ message: 'Motif (purpose) invalide' });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const targetField = purpose === 'transactions.send' ? 'receiver_phone' : 'phone';
  if (!req.body[targetField] || typeof req.body[targetField] !== 'string') {
    return res.status(400).json({ message: `Le champ ${targetField} est obligatoire` });
  }

  const userId = req.user.id;
  const bindingHash = computeBindingHash(purpose, req.body);

  try {
    // Check cooldown between RESEND calls (not between initial challenge and first resend)
    const resendKey = `${userId}:${purpose}:${bindingHash}`;
    const lastResendTime = resendCallTimes[resendKey];

    if (lastResendTime && Date.now() - lastResendTime < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ message: 'Veuillez patienter avant de redemander un code.' });
    }

    await generateAndSendOtp(userId, purpose, bindingHash);
    resendCallTimes[resendKey] = Date.now();
    res.json({ message: 'Nouveau code envoyé par SMS.' });

  } catch (error) {
    logger.error('Erreur renvoi OTP', { error: error.message, userId, purpose });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { resendOtp };
