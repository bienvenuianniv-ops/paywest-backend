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
const { sendOtpSMS } = require('../../src/config/sms');
const pool = require('../../src/config/db');
const { phoneVariants } = require('../../src/utils/phoneHelper');

let token;
const RECEIVER_PHONE = '+221770000001';

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      password: process.env.TEST_PASSWORD || 'Nanoushca@2007'
    });
  token = res.body.token;
});

beforeEach(() => {
  sendOtpSMS.mockClear();
  sendOtpSMS.mock.calls = [];
  sendOtpSMS.mock.results = [];
});

const lastOtpCode = () => sendOtpSMS.mock.calls[sendOtpSMS.mock.calls.length - 1][1];

// Annule un transfert de test (recredite l'expediteur, decredite le
// destinataire) pour ne pas faire deriver les soldes de paywest_test
// d'un run a l'autre.
const reverseTransfer = async (senderId, receiverPhone, amount) => {
  const variants = phoneVariants(receiverPhone);
  const placeholders = variants.map((_, i) => `$${i + 1}`).join(', ');
  const receiver = await pool.query(
    `SELECT id FROM users WHERE phone IN (${placeholders})`,
    variants
  );
  await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amount, senderId]);
  await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, receiver.rows[0].id]);
  await pool.query('DELETE FROM transactions WHERE sender_id = $1 AND type = $2 AND amount = $3', [senderId, 'transfer', amount]);
};

afterEach(async () => {
  try {
    await pool.query('DELETE FROM otp_codes WHERE purpose = $1', ['transactions.send']);
  } catch (error) {
    console.error('Error cleaning up OTP codes:', error.message);
  }
  // Small delay to ensure database state is settled before next test
  await new Promise(resolve => setTimeout(resolve, 50));
});

describe('OTP SMS — /api/transactions/send', () => {

  it('ne demande pas de code sous le seuil (100000 XOF)', async () => {
    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 100000 });

    expect(res.statusCode).toBe(200);
    expect(sendOtpSMS).not.toHaveBeenCalled();

    await reverseTransfer(res.body.transaction.sender_id, RECEIVER_PHONE, 100000);
  });

  it('exige un code au-dessus du seuil et envoie un SMS', async () => {
    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    expect(res.statusCode).toBe(403);
    expect(res.body.otp_required).toBe(true);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);
  });

  it('accepte le bon code et exécute le transfert', async () => {
    await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    const code = lastOtpCode();

    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: code });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('transaction');

    await reverseTransfer(res.body.transaction.sender_id, RECEIVER_PHONE, 150000);
  });

  it('rejette un mauvais code sans exécuter le transfert', async () => {
    await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: '000000' });

    expect(res.statusCode).toBe(401);
    expect(res.body.otp_invalid).toBe(true);
  });

  it('verrouille après 3 mauvais codes, même le bon code est ensuite rejeté', async () => {
    await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    const code = lastOtpCode();

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/transactions/send')
        .set('Authorization', `Bearer ${token}`)
        .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: '000000' });
    }

    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: code });

    expect(res.statusCode).toBe(401);
  });

  it('rejette la réutilisation d\'un code déjà utilisé', async () => {
    await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    const code = lastOtpCode();

    const first = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: code });

    await reverseTransfer(first.body.transaction.sender_id, RECEIVER_PHONE, 150000);

    const second = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: code });

    expect(second.statusCode).toBe(401);
  });

  it('un montant différent déclenche un nouveau défi plutôt qu\'un code invalide', async () => {
    await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    const oldCode = lastOtpCode();
    sendOtpSMS.mockClear();

    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 200000, otp_code: oldCode });

    expect(res.statusCode).toBe(403);
    expect(res.body.otp_required).toBe(true);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);
  });

});

describe('OTP SMS — /api/withdraw/wave', () => {
  const WITHDRAW_PHONE = '+221771234567';

  afterEach(async () => {
    await pool.query('DELETE FROM otp_codes WHERE purpose = $1', ['withdraw.wave']);
  });

  it('exige un code au-dessus du seuil', async () => {
    const res = await request(app)
      .post('/api/withdraw/wave')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 150000, phone: WITHDRAW_PHONE });

    expect(res.statusCode).toBe(403);
    expect(res.body.otp_required).toBe(true);
  });

  it('accepte le bon code et exécute le retrait', async () => {
    await request(app)
      .post('/api/withdraw/wave')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 150000, phone: WITHDRAW_PHONE });

    const code = lastOtpCode();

    const res = await request(app)
      .post('/api/withdraw/wave')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 150000, phone: WITHDRAW_PHONE, otp_code: code });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('transaction_id');

    // Recredite le wallet et nettoie la transaction de test — withdrawToWave
    // ne renvoie pas sender_id dans la reponse, on retrouve l'utilisateur
    // connecte par son email (meme compte que `token`, voir beforeAll).
    const admin = await pool.query('SELECT id FROM users WHERE email = $1', ['bienvenu@paywest.com']);
    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [150000, admin.rows[0].id]);
    await pool.query('DELETE FROM transactions WHERE id = $1', [res.body.transaction_id]);
  });
});
