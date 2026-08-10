const request = require('supertest');
const app = require('../../src/index');
const pool = require('../../src/config/db');

let adminToken;
let agentToken;

const CREDIT_AMOUNT = 1000;

beforeAll(async () => {
  // Login admin
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      password: process.env.TEST_PASSWORD
    });
  adminToken = adminRes.body.token;

  // Login agent
  const agentRes = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'agent@paywest.com',
      password: process.env.TEST_AGENT_PASSWORD
    });
  agentToken = agentRes.body.token;
});

describe('Agent', () => {

  describe('POST /api/agent/credit', () => {
    // Comme le rechargement admin, une recharge agent cree de la monnaie sans
    // contrepartie : sans annulation, paywest_test gagnait 1 000 XOF par run.
    // Ici l'API renvoie la transaction, on peut donc la supprimer par son id.
    let creditedTransaction = null;

    afterAll(async () => {
      if (!creditedTransaction) return;
      await pool.query('DELETE FROM transactions WHERE id = $1', [creditedTransaction.id]);
      await pool.query(
        'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2',
        [CREDIT_AMOUNT, creditedTransaction.receiver_id]
      );
      // Pas de pool.end() : voir la note dans platformAccount.test.js.
    });

    it('doit recharger le wallet d\'un client', async () => {
      const res = await request(app)
        .post('/api/agent/credit')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ client_phone: '770000001', amount: CREDIT_AMOUNT });
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('transaction');
      creditedTransaction = res.body.transaction;
    });

    it('doit rejeter un client inexistant', async () => {
      const res = await request(app)
        .post('/api/agent/credit')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ client_phone: '700000000', amount: 1000 });
      expect(res.statusCode).toBe(404);
    });

    it('doit rejeter sans token', async () => {
      const res = await request(app)
        .post('/api/agent/credit')
        .send({ client_phone: '770000001', amount: 1000 });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/agent/history', () => {
    it('doit retourner l\'historique des opérations', async () => {
      const res = await request(app)
        .get('/api/agent/history')
        .set('Authorization', `Bearer ${agentToken}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('doit rejeter un customer', async () => {
      const res = await request(app)
        .get('/api/agent/history')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.statusCode).toBe(200);
    });
  });

});