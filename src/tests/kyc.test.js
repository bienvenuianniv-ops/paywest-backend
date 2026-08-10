const request = require('supertest');
const app = require('../../src/index');

let token;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      password: process.env.TEST_PASSWORD
    });
  token = res.body.token;
});

describe('KYC', () => {

  describe('GET /api/kyc/status', () => {
    it('doit retourner le statut KYC', async () => {
      const res = await request(app)
        .get('/api/kyc/status')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status');
    });

    it('doit rejeter sans token', async () => {
      const res = await request(app).get('/api/kyc/status');
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/kyc (admin)', () => {
    it('doit retourner toutes les demandes KYC', async () => {
      const res = await request(app)
        .get('/api/kyc')
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/kyc/submit', () => {
    it('doit rejeter une demande déjà approuvée', async () => {
      const res = await request(app)
        .post('/api/kyc/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({
          document_type: 'CNI',
          document_number: '1234567890',
          full_name: 'Bienvenu Ianniv',
          date_of_birth: '1990-01-01',
          nationality: 'Congolaise'
        });
      expect(res.statusCode).toBe(400);
    });
  });

});