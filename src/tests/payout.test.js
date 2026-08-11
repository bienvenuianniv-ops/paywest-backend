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

let adminToken;
let agentToken;
let platformUserId;

beforeAll(async () => {
  const admin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'bienvenu@paywest.com', password: process.env.TEST_PASSWORD });
  adminToken = admin.body.token;

  const agent = await request(app)
    .post('/api/auth/login')
    .send({ email: 'agent@paywest.com', password: process.env.TEST_AGENT_PASSWORD });
  agentToken = agent.body.token;

  const platform = await pool.query(`SELECT id FROM users WHERE role = 'platform'`);
  platformUserId = platform.rows[0].id;
});

describe('GET /api/admin/platform-balance', () => {

  it('renvoie le solde du wallet plateforme a un admin', async () => {
    const expected = await pool.query(
      'SELECT balance, currency FROM wallets WHERE user_id = $1',
      [platformUserId]
    );

    const res = await request(app)
      .get('/api/admin/platform-balance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.platform_user_id).toBe(platformUserId);
    expect(res.body.balance).toBe(parseFloat(expected.rows[0].balance));
    expect(res.body.currency).toBe(expected.rows[0].currency);
  });

  it('refuse un compte non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/platform-balance')
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.statusCode).toBe(403);
  });

  it('refuse une requete sans jeton', async () => {
    const res = await request(app).get('/api/admin/platform-balance');

    expect(res.statusCode).toBe(401);
  });
});
