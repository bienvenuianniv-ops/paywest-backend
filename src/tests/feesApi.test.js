const request = require('supertest');
const app = require('../../src/index');

let token;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      // Aucune valeur de repli en dur : le depot est public.
      password: process.env.TEST_PASSWORD
    });
  token = res.body.token;
});

// Pas de pool.end() : voir la note dans platformAccount.test.js.

describe('GET /api/fees', () => {
  it('retourne la grille complete', async () => {
    const res = await request(app)
      .get('/api/fees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.currency).toBe('XOF');
    expect(res.body.tiers).toHaveLength(6);
    expect(res.body.tiers[0]).toEqual({ min: 0, max: 5000, fee: 100 });
    // Infinity n'est pas serialisable en JSON : la derniere borne est exposee
    // en null, ce que le client doit lire comme "sans limite haute".
    expect(res.body.tiers[5]).toEqual({ min: 500001, max: null, fee: 5000 });
  });

  it('rejette sans token', async () => {
    const res = await request(app).get('/api/fees');
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/fees/quote', () => {
  it('chiffre un transfert', async () => {
    const res = await request(app)
      .get('/api/fees/quote?amount=50000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      amount: 50000,
      fee: 500,
      total_debit: 50500,
      receiver_gets: 50000
    });
  });

  it.each([['0'], ['-100'], ['abc'], ['']])(
    'rejette le montant %p',
    async (amount) => {
      const res = await request(app)
        .get(`/api/fees/quote?amount=${amount}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(400);
    }
  );

  it('rejette un montant absent', async () => {
    const res = await request(app)
      .get('/api/fees/quote')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(400);
  });

  it('rejette sans token', async () => {
    const res = await request(app).get('/api/fees/quote?amount=1000');
    expect(res.statusCode).toBe(401);
  });
});
