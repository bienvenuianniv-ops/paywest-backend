const request = require('supertest');
const app = require('../../src/index');
const pool = require('../../src/config/db');

// Identifiants du compte jetable, hisses au niveau module pour que le
// nettoyage puisse les retrouver : sans ca, chaque run laissait un compte
// "Test Jest" derriere lui, et il fallait les supprimer a la main.
const suffix = Date.now().toString();
const throwawayEmail = `testjest${suffix}@paywest.com`;
const throwawayPhone = `7700${suffix.slice(-6)}`;

describe('Authentification', () => {

  afterAll(async () => {
    const user = await pool.query('SELECT id FROM users WHERE email = $1', [throwawayEmail]);
    if (user.rows.length === 0) return;

    const id = user.rows[0].id;
    // L'inscription cree un refresh_token et un wallet ; les transactions
    // d'abord, sinon la suppression du compte viole la cle etrangere.
    await pool.query('DELETE FROM transactions WHERE sender_id = $1 OR receiver_id = $1', [id]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM wallets WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    // Pas de pool.end() : voir la note dans platformAccount.test.js.
  });

  // Test inscription
  describe('POST /api/auth/register', () => {
    it('doit créer un compte avec des données valides', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          full_name: 'Test Jest',
          email: throwawayEmail,
          phone: throwawayPhone,
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