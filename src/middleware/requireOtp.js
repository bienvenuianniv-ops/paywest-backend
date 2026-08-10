const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const logger = require('../config/logger');
const { sendOtpSMS } = require('../config/sms');

const OTP_THRESHOLD = 100000;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Champs du body qui identifient de maniere unique une transaction pour
// chaque purpose — lient le code OTP a CE montant + CE destinataire precis,
// pour qu'un code obtenu pour une transaction ne puisse pas en autoriser
// une autre.
const BINDING_FIELDS = {
  'transactions.send': (body) => `${body.amount}:${body.receiver_phone}`,
  'withdraw.wave': (body) => `${body.amount}:${body.phone}`,
  'withdraw.orange': (body) => `${body.amount}:${body.phone}`
};

const isValidPurpose = (purpose) => Object.prototype.hasOwnProperty.call(BINDING_FIELDS, purpose);

const computeBindingHash = (purpose, body) => {
  const raw = BINDING_FIELDS[purpose](body);
  return crypto.createHash('sha256').update(raw).digest('hex');
};

// Invalide tout code actif pour ce binding, en genere et en envoie un
// nouveau par SMS au numero enregistre du compte (jamais a un numero
// fourni dans le body, sinon un attaquant avec un JWT vole pourrait
// simplement recevoir le code lui-meme).
const generateAndSendOtp = async (userId, purpose, bindingHash) => {
  // Numero lu AVANT toute ecriture : un JWT reste valide 7 jours, donc il peut
  // appartenir a un compte supprime entre-temps. Dereferencer rows[0] plus bas
  // aurait leve une TypeError masquee en 500, en laissant une ligne orpheline.
  const userResult = await pool.query('SELECT phone FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length === 0) {
    return { smsSent: false, userMissing: true };
  }

  await pool.query(
    'DELETE FROM otp_codes WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3',
    [userId, purpose, bindingHash]
  );

  // crypto.randomInt et non Math.random : Math.random n'est pas cryptographique
  // (V8 utilise xorshift128+, dont l'etat interne se reconstruit a partir de
  // quelques sorties observees). Un attaquant qui declenche des OTP sur son
  // propre compte pourrait sinon predire ceux emis pour d'autres comptes.
  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const inserted = await pool.query(
    `INSERT INTO otp_codes (user_id, purpose, code_hash, binding_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, purpose, codeHash, bindingHash, expiresAt]
  );

  try {
    await sendOtpSMS(userResult.rows[0].phone, code);
    return { smsSent: true };
  } catch (error) {
    logger.error('Erreur envoi SMS OTP', { error: error.message, userId, purpose });
    // Sans ce nettoyage, la ligne survivrait a l'echec d'envoi et compterait
    // ensuite comme "defi deja emis" : l'appelant recevrait un 403 « code deja
    // envoye » alors qu'aucun SMS n'est jamais parti.
    try {
      await pool.query('DELETE FROM otp_codes WHERE id = $1', [inserted.rows[0].id]);
    } catch (cleanupError) {
      logger.error('Erreur nettoyage OTP apres echec SMS', { error: cleanupError.message, userId, purpose });
    }
    return { smsSent: false };
  }
};

const requireOtp = (purpose) => async (req, res, next) => {
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= OTP_THRESHOLD) {
    return next();
  }

  const userId = req.user.id;
  const bindingHash = computeBindingHash(purpose, req.body);
  const otpCode = req.body.otp_code;

  try {
    if (!otpCode) {
      // Le filtre sur used_at/expires_at est essentiel : sans lui, la premiere
      // ligne creee pour un binding y restait pour toujours (rien ne purge
      // otp_codes), donc apres un transfert abouti tout nouveau transfert du
      // MEME montant au MEME destinataire recevait « un code a deja ete
      // envoye » sans qu'aucun SMS ne parte. La protection anti-spam reste
      // entiere : un code encore actif continue de bloquer la regeneration.
      const alreadyChallenged = await pool.query(
        `SELECT 1 FROM otp_codes
         WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3
         AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
        [userId, purpose, bindingHash]
      );

      if (alreadyChallenged.rows.length > 0) {
        // Un defi a deja ete envoye pour cette transaction precise : ne pas en
        // regenerer un a chaque resoumission (ca reinitialiserait le verrou de
        // tentatives et permettrait un envoi de SMS illimite) — rediriger vers
        // /api/otp/resend, qui a son propre cooldown independant.
        return res.status(403).json({
          otp_required: true,
          message: 'Un code a déjà été envoyé par SMS. Utilisez /api/otp/resend pour en redemander un.'
        });
      }

      const result = await generateAndSendOtp(userId, purpose, bindingHash);
      if (result.userMissing) {
        return res.status(401).json({ message: 'Compte introuvable' });
      }
      if (!result.smsSent) {
        return res.status(502).json({ message: "Erreur d'envoi du SMS, veuillez réessayer." });
      }
      return res.status(403).json({
        otp_required: true,
        message: 'Code envoyé par SMS, valable 5 minutes.'
      });
    }

    // Un code a-t-il deja ete emis pour EXACTEMENT ce montant+destinataire ?
    // Si non (le client a change le montant/destinataire entre-temps, ou
    // fourni un code d'une autre transaction), on traite comme "aucun code
    // fourni" plutot que "code invalide" : nouveau defi, nouveau SMS.
    // Volontairement SANS filtre sur used_at/expires_at, contrairement a
    // `alreadyChallenged` plus haut : les deux questions sont differentes.
    // Ici on demande « un defi a-t-il deja existe pour ce binding ? » afin de
    // distinguer un code appartenant a une autre transaction (-> nouveau defi)
    // d'un code perime ou deja consomme (-> 401 « demandez un nouveau code »).
    // Filtrer ici ferait repartir un SMS a chaque rejeu d'un code consomme.
    const everIssued = await pool.query(
      'SELECT 1 FROM otp_codes WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3 LIMIT 1',
      [userId, purpose, bindingHash]
    );

    if (everIssued.rows.length === 0) {
      const result = await generateAndSendOtp(userId, purpose, bindingHash);
      if (result.userMissing) {
        return res.status(401).json({ message: 'Compte introuvable' });
      }
      if (!result.smsSent) {
        return res.status(502).json({ message: "Erreur d'envoi du SMS, veuillez réessayer." });
      }
      return res.status(403).json({
        otp_required: true,
        message: 'Code envoyé par SMS, valable 5 minutes.'
      });
    }

    const active = await pool.query(
      `SELECT * FROM otp_codes
       WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3
       AND used_at IS NULL AND expires_at > NOW() AND attempts < $4
       ORDER BY created_at DESC LIMIT 1`,
      [userId, purpose, bindingHash, MAX_ATTEMPTS]
    );

    if (active.rows.length === 0) {
      return res.status(401).json({
        otp_invalid: true,
        message: 'Code invalide ou expiré. Demandez un nouveau code.'
      });
    }

    const otpRow = active.rows[0];
    const isMatch = await bcrypt.compare(String(otpCode), otpRow.code_hash);

    if (!isMatch) {
      await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otpRow.id]);
      return res.status(401).json({
        otp_invalid: true,
        message: 'Code invalide ou expiré. Demandez un nouveau code.'
      });
    }

    await pool.query('UPDATE otp_codes SET used_at = NOW() WHERE id = $1', [otpRow.id]);
    next();

  } catch (error) {
    logger.error('Erreur vérification OTP', { error: error.message, userId, purpose });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = {
  requireOtp,
  computeBindingHash,
  generateAndSendOtp,
  isValidPurpose,
  OTP_THRESHOLD,
  RESEND_COOLDOWN_MS
};
