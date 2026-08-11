// Neutralise les appels reseau sortants pendant les tests.
//
// Sans ca, chaque test qui declenche une notification appelle reellement
// l'API Resend (et envoie donc de vrais emails) et l'API Africa's Talking.
// Deux consequences : des effets de bord hors de la base de test, et surtout
// une latence non bornee — jusqu'a 3,6 s mesurees sur un seul test, ce qui
// faisait sauter le testTimeout de maniere intermittente.
//
// On mocke les *transports* (les paquets externes) plutot que nos propres
// modules : le code de src/config/mailer.js et src/config/sms.js continue de
// s'executer normalement, seul l'appel reseau est simule. Un fichier de test
// qui a besoin d'un comportement different (voir sms.test.js) peut toujours
// redefinir son propre mock, qui prend le pas sur celui-ci.

// Les identifiants de test viennent exclusivement de l'environnement : plus
// aucune valeur de repli en dur, le depot GitHub etant public. dotenv est
// charge ici car ce fichier s'execute AVANT que le test ne require
// src/index.js (qui est l'endroit ou dotenv etait charge jusqu'ici).
require('dotenv').config();

for (const variable of ['TEST_PASSWORD', 'TEST_AGENT_PASSWORD']) {
  if (!process.env[variable]) {
    throw new Error(
      `${variable} manquant : les tests se connectent avec cette variable, ` +
      'et aucun mot de passe n\'est code en dur. La definir dans .env.'
    );
  }
}

if (!process.env.PAYOUT_DESTINATION_EMAIL) {
  throw new Error(
    'PAYOUT_DESTINATION_EMAIL manquant : les tests de décaissement résolvent ' +
    'le compte bénéficiaire par cette variable. La définir dans .env.'
  );
}

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'test-email-id' }, error: null })
    }
  }))
}));

jest.mock('africastalking', () => jest.fn(() => ({
  SMS: {
    send: jest.fn().mockResolvedValue({
      SMSMessageData: { Message: 'Sent to 1/1 Total Cost: 0' }
    })
  }
})));

const pool = require('../../src/config/db');

// Compte tresorerie (beneficiaire des decaissements), cree ici plutot que dans
// payout.test.js : payoutDestination.test.js resout lui aussi
// PAYOUT_DESTINATION_EMAIL contre la base, et Jest execute les fichiers de
// test dans un ordre non garanti — sur une base paywest_test neuve,
// payoutDestination.test.js peut s'executer avant payout.test.js et echouer
// sur expected.rows[0].id, faute de ligne a trouver. Ce hook, enregistre par
// un fichier setupFilesAfterEnv, s'execute avant le beforeAll de CHAQUE
// fichier de test — c'est le seul endroit garanti anterieur aux deux suites.
//
// La forme inseree doit rester identique a celle d'initDb.js (meme nom, meme
// telephone, meme mot de passe '*', meme role 'treasury') : treasuryAccount.
// test.js verifie ces proprietes une a une, et il les verifierait sur la ligne
// creee ici si la base de test etait neuve. Une divergence entre les deux
// endroits ferait passer les tests sur une forme que la production n'a pas.
beforeAll(async () => {
  // ON CONFLICT sans cible, et non ON CONFLICT (email) : l'email est
  // parametre mais le telephone est fixe, or users.phone porte lui aussi une
  // contrainte UNIQUE. Si PAYOUT_DESTINATION_EMAIL designe une autre adresse
  // sur une base ou initDb.js a deja cree treasury@paywest.internal avec le
  // telephone TREASURY-ACCOUNT, l'insertion entre en conflit sur
  // users_phone_key — que ON CONFLICT (email) n'attrape pas. Ce hook etant
  // enregistre par setupFilesAfterEnv, le 23505 non gere ferait echouer le
  // beforeAll de TOUS les fichiers de test, sur une erreur sans rapport avec
  // ce qu'ils verifient.
  await pool.query(
    `INSERT INTO users (full_name, email, phone, password, role)
     VALUES ('PayWest Trésorerie', $1, 'TREASURY-ACCOUNT', '*', 'treasury')
     ON CONFLICT DO NOTHING`,
    [process.env.PAYOUT_DESTINATION_EMAIL]
  );

  const destination = await pool.query('SELECT id FROM users WHERE email = $1', [
    process.env.PAYOUT_DESTINATION_EMAIL
  ]);

  // Le DO NOTHING ci-dessus avale aussi le conflit de telephone : dans ce cas
  // aucune ligne n'est creee et la resolution ne trouve rien. Message explicite
  // plutot qu'un TypeError sur rows[0] repete dans chaque fichier de test.
  if (destination.rows.length === 0) {
    throw new Error(
      `Aucun compte pour PAYOUT_DESTINATION_EMAIL (${process.env.PAYOUT_DESTINATION_EMAIL}). ` +
      'Le telephone TREASURY-ACCOUNT est probablement deja pris par un autre compte ' +
      'de cette base : lancer `node src/config/initDb.js` et pointer la variable sur ' +
      'treasury@paywest.internal.'
    );
  }

  await pool.query(
    `INSERT INTO wallets (user_id, balance, currency)
     VALUES ($1, 0, 'XOF')
     ON CONFLICT (user_id) DO NOTHING`,
    [destination.rows[0].id]
  );
});
