const pool = require('../config/db');
const logger = require('../config/logger');
const {
  computeBindingHash,
  generateAndSendOtp,
  isValidPurpose,
  REQUIRED_BODY_FIELDS,
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

  const missing = REQUIRED_BODY_FIELDS[purpose].filter(
    (field) => !req.body[field] || typeof req.body[field] !== 'string'
  );
  if (missing.length > 0) {
    return res.status(400).json({ message: `Le champ ${missing[0]} est obligatoire` });
  }

  const userId = req.user.id;
  const bindingHash = computeBindingHash(purpose, req.body);

  try {
    // Un renvoi RAFRAICHIT un defi existant, il n'en cree jamais. Sans cette
    // verification, l'appelant pouvait forger un binding neuf a chaque requete
    // (montant +1 XOF) : le cooldown etant justement clé sur ce binding, il ne
    // s'appliquait jamais, et chaque appel envoyait un SMS au numero enregistre
    // du compte — le trou de SMS-bombing referme sur /send restait ouvert ici.
    const pending = await pool.query(
      `SELECT 1 FROM otp_codes
       WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3
       AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [userId, purpose, bindingHash]
    );

    if (pending.rows.length === 0) {
      return res.status(404).json({
        message: 'Aucun code en attente pour cette transaction. Soumettez la transaction pour en recevoir un.'
      });
    }

    // Le cooldown est reserve de maniere ATOMIQUE avant l'envoi. En deux temps
    // (SELECT puis UPDATE), deux requetes concurrentes lisaient toutes deux
    // « pas de cooldown » et envoyaient deux SMS, la seconde generation
    // invalidant au passage le code de la premiere.
    // Consequence assumee : un echec d'envoi consomme quand meme le cooldown,
    // l'utilisateur attend 60 s avant de pouvoir reessayer.
    const reserved = await pool.query(
      `INSERT INTO otp_resend_cooldowns (user_id, purpose, binding_hash, last_resend_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, purpose, binding_hash) DO UPDATE SET last_resend_at = NOW()
       WHERE otp_resend_cooldowns.last_resend_at < NOW() - make_interval(secs => $4)
       RETURNING 1`,
      [userId, purpose, bindingHash, RESEND_COOLDOWN_MS / 1000]
    );

    if (reserved.rowCount === 0) {
      return res.status(429).json({ message: 'Veuillez patienter avant de redemander un code.' });
    }

    const result = await generateAndSendOtp(userId, purpose, bindingHash);
    if (result.userMissing) {
      return res.status(401).json({ message: 'Compte introuvable' });
    }
    if (!result.smsSent) {
      return res.status(502).json({ message: "Erreur d'envoi du SMS, veuillez réessayer." });
    }

    res.json({ message: 'Nouveau code envoyé par SMS.' });

  } catch (error) {
    logger.error('Erreur renvoi OTP', { error: error.message, userId, purpose });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { resendOtp };
