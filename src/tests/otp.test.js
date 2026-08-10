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
// `transaction` est l'objet renvoye par l'API (res.body.transaction) : on
// supprime la ligne par son id et non par (sender_id, type, montant), qui
// emportait aussi les transactions homonymes d'autres tests ou les fixtures
// de paywest_test, source d'echecs intermittents difficiles a diagnostiquer.
const reverseTransfer = async (transaction, receiverPhone, amount) => {
  const variants = phoneVariants(receiverPhone);
  const placeholders = variants.map((_, i) => `$${i + 1}`).join(', ');
  const receiver = await pool.query(
    `SELECT id FROM users WHERE phone IN (${placeholders})`,
    variants
  );
  await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amount, transaction.sender_id]);
  await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, receiver.rows[0].id]);
  await pool.query('DELETE FROM transactions WHERE id = $1', [transaction.id]);
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

    await reverseTransfer(res.body.transaction, RECEIVER_PHONE, 100000);
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

    await reverseTransfer(res.body.transaction, RECEIVER_PHONE, 150000);
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

    await reverseTransfer(first.body.transaction, RECEIVER_PHONE, 150000);

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

  it('resoumettre la même requête sans otp_code ne renvoie pas un second SMS', async () => {
    const first = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    expect(first.statusCode).toBe(403);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);

    const second = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    expect(second.statusCode).toBe(403);
    expect(second.body.otp_required).toBe(true);
    expect(second.body.message).toMatch(/déjà été envoyé/);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);
  });

  it('un échec d\'envoi SMS renvoie 502 plutôt qu\'un faux succès', async () => {
    sendOtpSMS.mockRejectedValueOnce(new Error('SMS provider down'));

    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    expect(res.statusCode).toBe(502);
    expect(res.body.otp_required).toBeUndefined();
  });

  it('une resoumission avec la même Idempotency-Key après un défi OTP s\'exécute (pas de 403 en cache)', async () => {
    const idempotencyKey = `otp-idem-test-${Date.now()}`;

    const challenge = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    expect(challenge.statusCode).toBe(403);

    const code = lastOtpCode();

    const executed = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: code });

    expect(executed.statusCode).toBe(200);
    expect(executed.body).toHaveProperty('transaction');

    await reverseTransfer(executed.body.transaction, RECEIVER_PHONE, 150000);
    await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
  });

  it('réémet un défi après un code déjà consommé (même montant, même destinataire)', async () => {
    // Rien ne purge otp_codes : la ligne d'un transfert abouti restait
    // indéfiniment et comptait comme « défi déjà émis », donc tout transfert
    // ultérieur du même montant au même destinataire recevait un 403
    // « un code a déjà été envoyé » sans qu'aucun SMS ne parte.
    await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    const code = lastOtpCode();

    const done = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: code });

    expect(done.statusCode).toBe(200);
    await reverseTransfer(done.body.transaction, RECEIVER_PHONE, 150000);

    sendOtpSMS.mockClear();

    const again = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    expect(again.statusCode).toBe(403);
    expect(again.body.otp_required).toBe(true);
    expect(again.body.message).not.toMatch(/déjà été envoyé/);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);
  });

  it('un échec d\'envoi SMS ne bloque pas la tentative suivante', async () => {
    // La ligne otp_codes était insérée avant l'envoi : quand le SMS échouait,
    // elle survivait et faisait passer la tentative suivante pour un défi déjà
    // émis, alors qu'aucun code n'était jamais arrivé à l'utilisateur.
    sendOtpSMS.mockRejectedValueOnce(new Error('SMS provider down'));

    const failed = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 165000 });

    expect(failed.statusCode).toBe(502);

    sendOtpSMS.mockClear();

    const retry = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 165000 });

    expect(retry.statusCode).toBe(403);
    expect(retry.body.message).not.toMatch(/déjà été envoyé/);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);
  });

  it('un 502 n\'est pas mis en cache par l\'Idempotency-Key', async () => {
    // Le 502 invite explicitement à réessayer : le mettre en cache condamnait
    // la clé, le client recevant indéfiniment l'erreur enregistrée.
    const idempotencyKey = `otp-502-test-${Date.now()}`;
    sendOtpSMS.mockRejectedValueOnce(new Error('SMS provider down'));

    const first = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 172000 });

    expect(first.statusCode).toBe(502);

    const second = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 172000 });

    expect(second.statusCode).toBe(403);
    expect(second.body.otp_required).toBe(true);

    await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
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

describe('POST /api/otp/resend', () => {

  afterEach(async () => {
    await pool.query('DELETE FROM otp_codes WHERE purpose = $1', ['transactions.send']);
    await pool.query('DELETE FROM otp_resend_cooldowns WHERE purpose = $1', ['transactions.send']);
  });

  it('rejette un purpose invalide', async () => {
    const res = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'inconnu', amount: 150000, receiver_phone: RECEIVER_PHONE });

    expect(res.statusCode).toBe(400);
  });

  it('renvoie un nouveau code et invalide l\'ancien', async () => {
    await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000 });

    const firstCode = lastOtpCode();
    sendOtpSMS.mockClear();

    const resendRes = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'transactions.send', amount: 150000, receiver_phone: RECEIVER_PHONE });

    expect(resendRes.statusCode).toBe(200);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);

    const secondCode = lastOtpCode();
    expect(secondCode).not.toBe(firstCode);

    // L'ancien code ne doit plus fonctionner.
    const withOldCode = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: firstCode });

    expect(withOldCode.statusCode).toBe(401);

    // Le nouveau code doit fonctionner.
    const withNewCode = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 150000, otp_code: secondCode });

    expect(withNewCode.statusCode).toBe(200);
    await reverseTransfer(withNewCode.body.transaction, RECEIVER_PHONE, 150000);
  });

  it('applique un cooldown de 60s entre deux renvois', async () => {
    // Un renvoi rafraichit un defi existant : il faut donc d'abord en creer un.
    await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: 175000 });

    const first = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'transactions.send', amount: 175000, receiver_phone: RECEIVER_PHONE });

    expect(first.statusCode).toBe(200);

    const second = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'transactions.send', amount: 175000, receiver_phone: RECEIVER_PHONE });

    expect(second.statusCode).toBe(429);
  });

  it('refuse de creer un defi depuis /resend (anti SMS-bombing)', async () => {
    // Le cooldown est clé sur (user, purpose, binding) et le binding derive du
    // montant, controle par l'appelant. Si /resend pouvait creer un defi, il
    // suffisait d'incrementer le montant pour forger un binding neuf a chaque
    // appel et n'etre jamais soumis au cooldown : un SMS par requete.
    const res = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'transactions.send', amount: 181000, receiver_phone: RECEIVER_PHONE });

    expect(res.statusCode).toBe(404);
    expect(sendOtpSMS).not.toHaveBeenCalled();
  });

});
