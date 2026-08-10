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
const { phoneVariants } = require('../../src/utils/phoneHelper');

const RECEIVER_PHONE = '+221770000001';
const suffix = Date.now().toString().slice(-7);
const tempEmail = `regression.${suffix}@test.paywest`;
const tempPhone = `+22179${suffix}`;

let tempUserId;
let tempToken;

beforeAll(async () => {
  await request(app).post('/api/auth/register').send({
    full_name: 'Test Regression',
    email: tempEmail,
    phone: tempPhone,
    password: 'Test@12345'
  });

  const user = await pool.query('SELECT id FROM users WHERE email = $1', [tempEmail]);
  tempUserId = user.rows[0].id;

  // Large, pour que seul le plafond puisse refuser, jamais le solde.
  await pool.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [1000000, tempUserId]);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: tempEmail, password: 'Test@12345' });
  tempToken = login.body.token;
});

afterAll(async () => {
  // Les transactions d'abord : sinon la suppression du compte viole
  // transactions_sender_id_fkey et le compte jetable reste en base.
  await pool.query('DELETE FROM transactions WHERE sender_id = $1 OR receiver_id = $1', [tempUserId]);
  await pool.query('DELETE FROM otp_codes WHERE user_id = $1', [tempUserId]);
  await pool.query('DELETE FROM otp_resend_cooldowns WHERE user_id = $1', [tempUserId]);
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [tempUserId]);
  await pool.query('DELETE FROM wallets WHERE user_id = $1', [tempUserId]);
  await pool.query('DELETE FROM users WHERE id = $1', [tempUserId]);
  // Pas de pool.end() : voir la note dans platformAccount.test.js.
});

describe('Les frais restent hors des plafonds BCEAO', () => {
  it('accepte un montant egal au plafond par transaction (150 000) malgre un debit reel de 152 500', async () => {
    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    // 403 = defi OTP, donc checkTransactionLimits a laisse passer (il
    // s'execute AVANT requireOtp dans transactionRoutes.js). Si les frais
    // comptaient dans le plafond, 152 500 > 150 000 aurait produit un 400
    // avant meme d'atteindre requireOtp.
    expect(res.statusCode).toBe(403);
    expect(res.body.message).not.toMatch(/plafond|maximum/i);
  });
});

describe('Le seuil OTP porte sur le montant seul', () => {
  it('ne declenche pas d OTP a 100 000 exactement, malgre un debit reel de 101 000', async () => {
    const balanceBefore = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [tempUserId]);

    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 100000 });

    expect(res.statusCode).toBe(200);
    expect(res.body.fee).toBe(1000);
    expect(res.body.total_debit).toBe(101000);

    // Remise en etat. La resolution passe par phoneVariants : le numero peut
    // etre stocke sous plusieurs formats en base, une egalite stricte
    // renverrait zero ligne et ferait planter le nettoyage.
    const variants = phoneVariants(RECEIVER_PHONE);
    const placeholders = variants.map((_, i) => `$${i + 1}`).join(', ');
    const receiver = await pool.query(
      `SELECT id FROM users WHERE phone IN (${placeholders})`,
      variants
    );

    await pool.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [
      parseFloat(balanceBefore.rows[0].balance),
      tempUserId
    ]);
    await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [100000, receiver.rows[0].id]);
    await pool.query(
      `UPDATE wallets SET balance = balance - $1
       WHERE user_id = (SELECT id FROM users WHERE role = 'platform')`,
      [1000]
    );
    await pool.query('DELETE FROM transactions WHERE id = $1', [res.body.transaction.id]);
  });
});
