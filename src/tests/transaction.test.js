const request = require('supertest');
const app = require('../../src/index');

let token;

beforeAll(async () => {
  // Connexion avant les tests
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      password: process.env.TEST_PASSWORD || '123456'
    });
  token = res.body.token;
});

describe('Transactions', () => {

  // Test wallet
  describe('GET /api/wallet', () => {
    it('doit retourner le solde', async () => {
      const res = await request(app)
        .get('/api/wallet')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('balance');
      expect(res.body).toHaveProperty('currency');
    });

    it('doit rejeter sans token', async () => {
      const res = await request(app)
        .get('/api/wallet');
      expect(res.statusCode).toBe(401);
    });
  });

  // Test transfert
  describe('POST /api/transactions/send', () => {
    it('doit rejeter un montant invalide', async () => {
      const res = await request(app)
        .post('/api/transactions/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          receiver_phone: '+221770000001',
          amount: -100
        });
      expect(res.statusCode).toBe(400);
    });

    it('doit rejeter un destinataire inexistant', async () => {
      const res = await request(app)
        .post('/api/transactions/send')
        .set('Authorization', `Bearer ${token}`)
        .send({
          receiver_phone: '+221799999999',
          amount: 100
        });
      expect(res.statusCode).toBe(404);
    });
  });

  // Test historique
  describe('GET /api/transactions', () => {
    it('doit retourner la liste des transactions', async () => {
      const res = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('data');
expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

});