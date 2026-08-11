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
      'PAYOUT_DESTINATION_EMAIL non définie : aucun compte bénéficiaire configuré pour le décaissement.'
    );
  }

  const result = await pool.query('SELECT id, password FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    throw new Error(`Compte de décaissement introuvable pour l'email configuré (${email}).`);
  }

  const id = result.rows[0].id;

  // Le bénéficiaire DOIT être un compte non connectable. C'est la seule chose
  // qui rende le décaissement sûr : un jeton admin volé peut le déclencher, il
  // ne doit pas pouvoir en récupérer le produit. Un compte auquel on peut
  // ouvrir une session sortirait l'argent par /api/transactions/send, sous le
  // seuil OTP, sans rien laisser passer par cette route.
  //
  // Vérifié à l'exécution et pas seulement par convention, parce que deux
  // chemins mènent à un bénéficiaire connectable sans que personne ne le
  // remarque : une variable d'environnement repointée vers un compte de login,
  // et l'inscription d'un compte à l'adresse réservée avant que le vrai compte
  // ne soit créé (/api/auth/register est ouvert et ne réserve aucune adresse,
  // et l'email figure en clair dans un dépôt public). Dans les deux cas, le
  // décaissement refuse de bouger plutôt que de créditer un wallet dont
  // quelqu'un d'autre a la clé.
  //
  // '*' n'est jamais un hash bcrypt valide : c'est la marque des comptes
  // système, posée par initDb.js.
  if (result.rows[0].password !== '*') {
    throw new Error(
      `Compte de décaissement connectable (${email}) : le bénéficiaire doit être ` +
      "un compte système non connectable. Vérifier qu'aucun compte n'a été inscrit " +
      'à cette adresse et rejouer `node src/config/initDb.js`.'
    );
  }

  // Un beneficiaire egal au compte plateforme ferait une ecriture qui ne
  // deplace rien tout en enregistrant une transaction : c'est une erreur de
  // configuration, pas une operation legitime.
  const platformId = await getPlatformUserId();
  if (id === platformId) {
    throw new Error(
      'PAYOUT_DESTINATION_EMAIL désigne le compte plateforme lui-même : configuration incohérente.'
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
