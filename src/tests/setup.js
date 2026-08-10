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
