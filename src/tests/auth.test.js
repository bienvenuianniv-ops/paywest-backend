const request = require('supertest');
const app = require('../../src/index');

describe('Authentification', () => {

  // Test inscription
  describe('POST /api/auth/register', () => {
    it('doit créer un compte avec des données valides', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          full_name: 'Test Jest',
          email: `testjest${Date.now()}@paywest.com`,
          phone: `7700${Date.now().toString().slice(-6)}`,
          password: '123456'
        });
      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.role).toBe('customer');
    });

    it('doit rejeter un email invalide', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          full_name: 'Test Jest',
          email: 'emailinvalide',
          phone: '770000099',
          password: '123456'
        });
      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('errors');
    });

    it('doit rejeter un mot de passe trop court', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          full_name: 'Test Jest',
          email: 'test@paywest.com',
          phone: '770000099',
          password: '123'
        });
      expect(res.statusCode).toBe(400);
    });
  });

  // Test connexion
  describe('POST /api/auth/login', () => {
    it('doit connecter avec des identifiants valides', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'bienvenu@paywest.com',
          password: process.env.TEST_PASSWORD || '123456'
        });
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('token');
    });

    it('doit rejeter un mauvais mot de passe', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'bienvenu@paywest.com',
          password: 'mauvaismdp'
        });
      expect(res.statusCode).toBe(401);
    });
  });

});