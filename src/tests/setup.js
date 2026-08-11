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
