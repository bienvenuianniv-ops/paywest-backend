const request = require('supertest');
const app = require('../../src/index');

let token;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      password: process.env.TEST_PASSWORD || 'Nanoushca@2007'
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
    it('doit recharger un wallet (admin)', async () => {
      const res = await request(app)
        .post('/api/wallet/credit')
        .set('Authorization', `Bearer ${token}`)
        .send({ user_id: 2, amount: 1000 });
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