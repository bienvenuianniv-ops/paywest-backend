const pool = require('../config/db');
const logger = require('../config/logger');
const {
  computeBindingHash,
  generateAndSendOtp,
  isValidPurpose,
  RESEND_COOLDOWN_MS
} = require('../middleware/requireOtp');

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
    const cooldownCheck = await pool.query(
      'SELECT last_resend_at FROM otp_resend_cooldowns WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3',
      [userId, purpose, bindingHash]
    );

    if (cooldownCheck.rows.length > 0) {
      const ageMs = Date.now() - new Date(cooldownCheck.rows[0].last_resend_at).getTime();
      if (ageMs < RESEND_COOLDOWN_MS) {
        return res.status(429).json({ message: 'Veuillez patienter avant de redemander un code.' });
      }
    }

    await generateAndSendOtp(userId, purpose, bindingHash);

    // Update or insert resend cooldown timestamp
    await pool.query(
      `INSERT INTO otp_resend_cooldowns (user_id, purpose, binding_hash, last_resend_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, purpose, binding_hash) DO UPDATE SET last_resend_at = NOW()`,
      [userId, purpose, bindingHash]
    );

    res.json({ message: 'Nouveau code envoyé par SMS.' });

  } catch (error) {
    logger.error('Erreur renvoi OTP', { error: error.message, userId, purpose });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { resendOtp };
