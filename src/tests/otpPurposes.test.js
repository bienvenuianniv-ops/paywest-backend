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
const {
  requireOtp,
  computeBindingHash,
  isValidPurpose,
  OTP_THRESHOLDS,
  REQUIRED_BODY_FIELDS
} = require('../../src/middleware/requireOtp');

let token;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'bienvenu@paywest.com', password: process.env.TEST_PASSWORD });
  token = res.body.token;
});

describe('Seuils OTP par usage', () => {

  it('conserve le seuil de 100000 pour les trois usages clients', () => {
    expect(OTP_THRESHOLDS['transactions.send']).toBe(100000);
    expect(OTP_THRESHOLDS['withdraw.wave']).toBe(100000);
    expect(OTP_THRESHOLDS['withdraw.orange']).toBe(100000);
  });

  it('exige un code a tout montant pour le decaissement', () => {
    expect(OTP_THRESHOLDS['admin.payout']).toBe(0);
  });

  it('reconnait admin.payout comme un usage valide', () => {
    expect(isValidPurpose('admin.payout')).toBe(true);
    expect(isValidPurpose('admin.inexistant')).toBe(false);
  });

  it('refuse de construire un middleware pour un usage inconnu', () => {
    expect(() => requireOtp('admin.inexistant')).toThrow(/inconnu/i);
  });

  it('lie le code au montant du decaissement', () => {
    const a = computeBindingHash('admin.payout', { amount: 5000 });
    const b = computeBindingHash('admin.payout', { amount: 5001 });

    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
    expect(computeBindingHash('admin.payout', { amount: 5000 })).toBe(a);
  });

  it('n exige aucun champ de body pour le decaissement', () => {
    expect(REQUIRED_BODY_FIELDS['admin.payout']).toEqual([]);
    expect(REQUIRED_BODY_FIELDS['transactions.send']).toEqual(['receiver_phone']);
  });
});

describe('/api/otp/resend — champs requis par usage', () => {

  it('accepte un renvoi admin.payout sans champ telephone', async () => {
    const res = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'admin.payout', amount: 5000 });

    // 404 = aucun defi en attente, ce qui est la reponse attendue ici. Le
    // point du test est qu'on n'obtient PAS un 400 reclamant un champ
    // `phone` qui n'a aucun sens pour un decaissement.
    expect(res.statusCode).toBe(404);
  });

  it('continue d exiger receiver_phone pour un transfert', async () => {
    const res = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'transactions.send', amount: 150000 });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/receiver_phone/);
  });

  it('continue d exiger phone pour un retrait', async () => {
    const res = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'withdraw.wave', amount: 150000 });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/phone/);
  });
});
