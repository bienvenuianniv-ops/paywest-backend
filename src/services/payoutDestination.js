const pool = require('../config/db');
const { getPlatformUserId } = require('./platformAccount');

// Meme raisonnement que platformAccount : l'id ne change pas d'un
// decaissement a l'autre, on le resout une fois et on le memorise.
let cachedId = null;

// Le beneficiaire est resolu cote serveur, jamais lu dans la requete : un
// compte admin compromis peut declencher un decaissement, mais pas le
// detourner. Le changer suppose un acces aux variables d'environnement.
const getPayoutDestinationId = async () => {
  if (cachedId !== null) return cachedId;

  const email = process.env.PAYOUT_DESTINATION_EMAIL;
  if (!email) {
    throw new Error(
      'PAYOUT_DESTINATION_EMAIL non definie : aucun compte beneficiaire configure pour le decaissement.'
    );
  }

  const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    throw new Error(`Compte de decaissement introuvable pour l'email configure (${email}).`);
  }

  const id = result.rows[0].id;

  // Un beneficiaire egal au compte plateforme ferait une ecriture qui ne
  // deplace rien tout en enregistrant une transaction : c'est une erreur de
  // configuration, pas une operation legitime.
  const platformId = await getPlatformUserId();
  if (id === platformId) {
    throw new Error(
      'PAYOUT_DESTINATION_EMAIL designe le compte plateforme lui-meme : configuration incoherente.'
    );
  }

  cachedId = id;
  return cachedId;
};

// Reservee aux tests.
const resetPayoutDestinationCache = () => {
  cachedId = null;
};

module.exports = { getPayoutDestinationId, resetPayoutDestinationCache };
