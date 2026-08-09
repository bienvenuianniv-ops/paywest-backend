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
});

const lastOtpCode = () => sendOtpSMS.mock.calls[sendOtpSMS.mock.calls.length - 1][1];

// Annule un transfert de test (recredite l'expediteur, decredite le
// destinataire) pour ne pas faire deriver les soldes de paywest_test
// d'un run a l'autre.
const reverseTransfer = async (senderId, receiverPhone, amount) => {
  const receiver = await pool.query('SELECT id FROM users WHERE phone = $1', [receiverPhone]);
  await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amount, senderId]);
  await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, receiver.rows[0].id]);
  await pool.query('DELETE FROM transactions WHERE sender_id = $1 AND type = $2 AND amount = $3', [senderId, 'transfer', amount]);
};

afterEach(async () => {
  await pool.query('DELETE FROM otp_codes WHERE purpose = $1', ['transactions.send']);
});

describe('OTP SMS — /api/transactions/send', () => {

  it('ne demande pas de code sous le seuil (100000 XOF)', async () => {
    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 100000 });

    expect(res.statusCode).toBe(404);
    expect(sendOtpSMS).not.toHaveBeenCalled();
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
