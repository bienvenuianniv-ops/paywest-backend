const request = require('supertest');
const app = require('../../src/index');
const pool = require('../../src/config/db');

let token;

// Cible du rechargement de test, et montant credite.
const CREDITED_USER_ID = 2;
const CREDIT_AMOUNT = 1000;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      password: process.env.TEST_PASSWORD
    });
  token = res.body.token;
});

describe('Wallet', () => {

  describe('GET /api/wallet', () => {
    it('doit retourner le solde', async () => {
      const res = await request(app)
        .get('/api/wallet')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('balance');
      expect(res.body).toHaveProperty('currency');
      expect(res.body.currency).toBe('XOF');
    });

    it('doit rejeter sans token', async () => {
      const res = await request(app).get('/api/wallet');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/wallet/credit', () => {
    // Un rechargement cree de la monnaie sans contrepartie (c'est un
    // encaissement d'especes). Sans annulation, paywest_test gagnait 1 000 XOF
    // a chaque run. On borne par l'id max d'avant l'appel plutot que de
    // supprimer sur (sender, type, montant), qui emporterait les transactions
    // homonymes d'autres tests.
    let maxIdBefore = 0;

    afterAll(async () => {
      await pool.query(
        `DELETE FROM transactions
         WHERE id > $1 AND receiver_id = $2 AND type = 'credit' AND amount = $3`,
        [maxIdBefore, CREDITED_USER_ID, CREDIT_AMOUNT]
      );
      await pool.query(
        'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2',
        [CREDIT_AMOUNT, CREDITED_USER_ID]
      );
      // Pas de pool.end() : voir la note dans platformAccount.test.js.
    });

    it('doit recharger un wallet (admin)', async () => {
      const before = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM transactions');
      maxIdBefore = Number(before.rows[0].m);

      const res = await request(app)
        .post('/api/wallet/credit')
        .set('Authorization', `Bearer ${token}`)
        .send({ user_id: CREDITED_USER_ID, amount: CREDIT_AMOUNT });
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('wallet');
    });

    it('doit rejeter un montant invalide', async () => {
      const res = await request(app)
        .post('/api/wallet/credit')
        .set('Authorization', `Bearer ${token}`)
        .send({ user_id: 2, amount: -100 });
      expect(res.statusCode).toBe(400);
    });
  });

});