const pool = require('../config/db');
const logger = require('../config/logger');

// Une cle laissee "en cours" (response_status NULL) au-dela de ce delai est
// consideree comme abandonnee (crash, timeout) plutot que reellement en
// cours de traitement, pour ne pas bloquer indefiniment les retries.
const STALE_PENDING_MS = 2 * 60 * 1000;

// Protection contre les doubles envois client (retry apres timeout reseau,
// double-clic) : si le client fournit un header Idempotency-Key, on renvoie
// exactement la meme reponse pour un rejeu de la meme cle, sans re-executer
// l'operation. Optionnel : sans header, comportement inchange (aucune
// protection), pour ne pas casser les clients existants qui ne l'envoient
// pas encore.
const idempotency = (label) => async (req, res, next) => {
  const key = req.headers['idempotency-key'];
  if (!key) return next();

  const userId = req.user.id;

  try {
    const existing = await pool.query(
      'SELECT * FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND endpoint = $3',
      [userId, key, label]
    );

    if (existing.rows.length > 0) {
      const record = existing.rows[0];

      if (record.response_status !== null) {
        return res.status(record.response_status).json(record.response_body);
      }

      const ageMs = Date.now() - new Date(record.created_at).getTime();
      if (ageMs < STALE_PENDING_MS) {
        return res.status(409).json({ message: 'Requête déjà en cours de traitement' });
      }

      // Cle en attente depuis trop longtemps : probable crash avant reponse,
      // on la remplace pour laisser une nouvelle tentative passer.
      await pool.query(
        'DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND endpoint = $3',
        [userId, key, label]
      );
    }

    await pool.query(
      'INSERT INTO idempotency_keys (user_id, key, endpoint) VALUES ($1, $2, $3)',
      [userId, key, label]
    );

    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      // Un defi OTP (otp_required/otp_invalid) n'est pas une issue finale :
      // la transaction n'a pas eu lieu. Le mettre en cache bloquerait pour
      // toujours une resoumission avec la meme Idempotency-Key et le bon
      // code, puisque la reponse en cache serait renvoyee sans jamais
      // re-executer requireOtp.
      const isOtpChallenge = body && (body.otp_required === true || body.otp_invalid === true);

      if (isOtpChallenge) {
        // Supprimer la ligne d'idempotency pour laisser la resoumission
        // creer une nouvelle ligne et executer le traitement.
        try {
          await pool.query(
            'DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND endpoint = $3',
            [userId, key, label]
          );
        } catch (error) {
          logger.error('Erreur suppression idempotency OTP', { error: error.message });
        }
        return originalJson(body);
      }

      // Attendre que la reponse soit persistee AVANT de l'envoyer au client :
      // sinon un retry tres rapide peut arriver avant que la ligne soit
      // marquee "traitee", et recevoir un 409 au lieu de la reponse en cache.
      try {
        await pool.query(
          `UPDATE idempotency_keys SET response_status = $1, response_body = $2
           WHERE user_id = $3 AND key = $4 AND endpoint = $5`,
          [res.statusCode, body, userId, key, label]
        );
      } catch (error) {
        logger.error('Erreur sauvegarde idempotency', { error: error.message });
      }
      return originalJson(body);
    };

    next();

  } catch (error) {
    // Violation de contrainte unique : une requete concurrente identique a
    // gagne la course de l'INSERT juste avant nous.
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Requête déjà en cours de traitement' });
    }
    logger.error('Erreur middleware idempotency', { error: error.message });
    next(error);
  }
};

module.exports = { idempotency };
