const request = require('supertest');

jest.mock('../../src/config/sms', () => ({
  sendSMS: jest.fn(),
  sendWelcomeSMS: jest.fn(),
  sendTransferSMS: jest.fn(),
  sendDepositSMS: jest.fn(),
  sendWithdrawSMS: jest.fn(),
  sendOtpSMS: jest.fn().mockResolvedValue(undefined)
}));

const app = require('../../src/index');
const pool = require('../../src/config/db');
const { getPlatformUserId } = require('../../src/services/platformAccount');

// Resolu depuis l'environnement et NON code en dur : c'est cette variable que
// createPayout suit pour choisir le beneficiaire. Avec une adresse en dur, ces
// quatre tests resteraient verts en inspectant une ligne que le decaissement
// n'utilise pas — y compris dans le cas precis qu'ils existent pour interdire,
// une variable repointee vers un compte de login. setup.js garantit que la
// variable est definie et que la ligne existe.
const TREASURY_EMAIL = process.env.PAYOUT_DESTINATION_EMAIL;

// Le compte tresorerie est le beneficiaire des decaissements en production.
// Tout son interet est d'etre un cul-de-sac : l'argent y entre par
// /api/admin/payout et rien, cote API, ne peut l'en faire sortir. Ce fichier
// verifie chacune des proprietes qui portent cette garantie — elles tiennent a
// des details de donnees (password '*', telephone non numerique, role distinct)
// qu'aucun test ne surveillerait autrement, et dont la perte serait
// silencieuse : le decaissement continuerait de fonctionner exactement pareil.
describe('compte tresorerie', () => {

  it('existe, avec un wallet', async () => {
    const account = await pool.query(
      'SELECT id, role, password FROM users WHERE email = $1',
      [TREASURY_EMAIL]
    );

    expect(account.rows).toHaveLength(1);

    const wallet = await pool.query('SELECT user_id FROM wallets WHERE user_id = $1', [
      account.rows[0].id
    ]);

    // Sans cette ligne, createPayout debiterait la plateforme et crediterait
    // zero ligne : c'est le trou trouve en tache 5, referme cote controleur
    // mais qui n'a aucune raison de se rouvrir ici.
    expect(wallet.rows).toHaveLength(1);
  });

  it('n est connectable avec aucun mot de passe', async () => {
    // '*' n'est pas un hash bcrypt valide : bcrypt.compare renvoie false quoi
    // qu'on lui presente. On ne teste donc pas « le bon mot de passe echoue »
    // (il n'y en a pas), mais qu'aucune entree ne franchit le login.
    //
    // Assertion portee sur l'absence de jeton et non sur un code precis : les
    // entrees se font refuser a des etages differents ('' est arrete par le
    // validateur en 400, les autres par bcrypt.compare en 401). Le code de
    // statut n'est pas la propriete qui compte ici — la delivrance d'un jeton
    // l'est, et c'est la seule chose qu'un futur changement pourrait casser
    // sans qu'on s'en apercoive.
    for (const password of ['*', '', 'password', process.env.TEST_PASSWORD]) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: TREASURY_EMAIL, password });

      expect(res.status).not.toBe(200);
      expect(res.body.token).toBeUndefined();
    }
  });

  it('n est pas resolu comme compte plateforme', async () => {
    // platformAccount.js resout par `role = 'platform' ORDER BY id LIMIT 1`.
    // Donner le role 'platform' au compte tresorerie en ferait un second
    // candidat, departage par un ORDER BY — le decaissement se mettrait a
    // debiter et crediter la meme ligne selon les id en presence.
    const platformRows = await pool.query(`SELECT id FROM users WHERE role = 'platform'`);
    expect(platformRows.rows).toHaveLength(1);

    const treasury = await pool.query('SELECT id, role FROM users WHERE email = $1', [
      TREASURY_EMAIL
    ]);
    expect(treasury.rows[0].role).not.toBe('platform');
    expect(treasury.rows[0].id).not.toBe(await getPlatformUserId());
  });

  it('ne peut pas etre vise comme destinataire d un transfert', async () => {
    // N'importe quel compte authentifie fait l'affaire : on teste la
    // resolution du destinataire, pas les droits de l'appelant. On prend le
    // compte admin parce que TEST_PASSWORD est garde par setup.js — un
    // identifiant non garde ferait echouer ce test sur un ecart d'assertion
    // (401 au lieu de 400) au lieu d'un message clair.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bienvenu@paywest.com', password: process.env.TEST_PASSWORD });

    expect(login.body.token).toBeDefined();

    const treasury = await pool.query('SELECT phone FROM users WHERE email = $1', [
      TREASURY_EMAIL
    ]);

    // Montant volontairement sous le seuil OTP de transactions.send : le but
    // est d'atteindre la resolution du destinataire, pas de declencher un defi.
    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ receiver_phone: treasury.rows[0].phone, amount: 1000 });

    try {
      // Le telephone du compte ne satisfait pas ^\+?[0-9]{8,15}$ : le
      // validateur de transferRules le rejette avant meme la recherche en base.
      expect(res.status).toBe(400);

      const received = await pool.query(
        `SELECT COUNT(*) FROM transactions WHERE receiver_id = (SELECT id FROM users WHERE email = $1)
         AND type = 'transfer'`,
        [TREASURY_EMAIL]
      );
      expect(parseInt(received.rows[0].count, 10)).toBe(0);
    } finally {
      // Le jour ou la garde regresse — c'est-a-dire le jour ou ce test sert
      // enfin a quelque chose — le transfert REUSSIT : l'assertion echoue,
      // mais 1 000 XOF plus les frais ont deja quitte le wallet admin pour le
      // wallet tresorerie, definitivement. La somme des wallets de
      // paywest_test derive alors silencieusement, et les egalites strictes
      // de payout.test.js sur le solde beneficiaire se mettent a casser sans
      // rapport apparent avec la cause. Un test qui detecte une regression ne
      // doit pas laisser la base dans l'etat qu'il denonce.
      if (res.body && res.body.transaction) {
        const tx = res.body.transaction;
        await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [
          parseFloat(tx.amount),
          tx.receiver_id
        ]);
        await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [
          parseFloat(tx.amount) + parseFloat(tx.fee || 0),
          tx.sender_id
        ]);
        if (parseFloat(tx.fee || 0) > 0) {
          await pool.query(
            `UPDATE wallets SET balance = balance - $1
             WHERE user_id = (SELECT id FROM users WHERE role = 'platform')`,
            [parseFloat(tx.fee)]
          );
        }
        await pool.query('DELETE FROM transactions WHERE id = $1', [tx.id]);
      }
    }
  });
});
