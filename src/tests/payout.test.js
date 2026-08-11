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
let destinationUserId;

const balanceOf = async (userId) => {
  const res = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
  return parseFloat(res.rows[0].balance);
};

// Cree du solde sur le wallet plateforme pour pouvoir le decaisser. La
// contrepartie est retiree en fin de test : la somme des wallets de
// paywest_test doit etre strictement identique avant et apres le run.
const creditPlatform = async (amount) => {
  await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amount, platformUserId]);
};

// Annule un decaissement : le wallet plateforme a deja ete debite par la
// route, il reste a retirer ce qui a ete credite au beneficiaire et a
// supprimer la ligne de transaction par son id.
const reversePayout = async (transaction) => {
  await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [
    parseFloat(transaction.amount),
    transaction.receiver_id
  ]);
  await pool.query('DELETE FROM transactions WHERE id = $1', [transaction.id]);
};

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

  const destination = await pool.query('SELECT id FROM users WHERE email = $1', [
    process.env.PAYOUT_DESTINATION_EMAIL
  ]);
  destinationUserId = destination.rows[0].id;
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

const { sendOtpSMS } = require('../../src/config/sms');

const lastOtpCode = () => sendOtpSMS.mock.calls[sendOtpSMS.mock.calls.length - 1][1];

describe('POST /api/admin/payout', () => {

  beforeEach(() => {
    sendOtpSMS.mockClear();
    sendOtpSMS.mock.calls = [];
  });

  afterEach(async () => {
    await pool.query('DELETE FROM otp_codes WHERE purpose = $1', ['admin.payout']);
    await pool.query('DELETE FROM otp_resend_cooldowns WHERE purpose = $1', ['admin.payout']);
  });

  it('refuse un compte non-admin', async () => {
    const before = await balanceOf(platformUserId);

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ amount: 1000 });

    expect(res.statusCode).toBe(403);
    expect(await balanceOf(platformUserId)).toBe(before);
  });

  it('exige un code OTP meme pour 1 XOF', async () => {
    const before = await balanceOf(platformUserId);

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 1 });

    expect(res.statusCode).toBe(403);
    expect(res.body.otp_required).toBe(true);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);
    expect(await balanceOf(platformUserId)).toBe(before);
  });

  it('deplace l argent vers le beneficiaire avec le bon code', async () => {
    const amount = 5000;
    await creditPlatform(amount);

    const platformBefore = await balanceOf(platformUserId);
    const destinationBefore = await balanceOf(destinationUserId);

    await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount });

    const code = lastOtpCode();

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, otp_code: code });

    // try/finally : d'autres suites de tests tournent en parallele sur les
    // memes comptes partages (plateforme, admin) et peuvent faire echouer une
    // assertion de solde par pure coincidence de timing. Sans ce filet, un
    // echec ici sauterait reversePayout et laisserait une derive permanente
    // dans paywest_test — inacceptable pour une route qui deplace de l'argent.
    try {
      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.type).toBe('payout');
      expect(res.body.transaction.status).toBe('completed');
      expect(res.body.transaction.sender_id).toBe(platformUserId);
      expect(res.body.transaction.receiver_id).toBe(destinationUserId);

      expect(await balanceOf(platformUserId)).toBe(platformBefore - amount);
      expect(await balanceOf(destinationUserId)).toBe(destinationBefore + amount);
    } finally {
      // Deux issues possibles : le decaissement a reussi (une ligne de
      // transaction existe, reversePayout retire ce qui a ete credite au
      // beneficiaire) ou il a echoue pour une raison externe — par exemple un
      // deadlock Postgres avec une autre suite qui verrouille les memes lignes
      // de wallet en parallele (le compte de decaissement de test et le
      // compte admin partage sont le meme utilisateur). Dans ce second cas
      // aucune transaction n'a ete creee, mais le credit artificiel pose par
      // creditPlatform plus haut est toujours la et doit etre retire a la main.
      if (res.body.transaction) {
        await reversePayout(res.body.transaction);
      } else {
        await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, platformUserId]);
      }
    }
  });

  it('masque le code OTP dans le journal d audit', async () => {
    const amount = 6000;
    await creditPlatform(amount);

    await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount });

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, otp_code: lastOtpCode() });

    // try/finally : voir le commentaire du test precedent — garantit la
    // remise en etat meme si l'assertion sur le journal d'audit echoue.
    try {
      const audit = await pool.query(
        `SELECT details FROM audit_logs WHERE action = 'admin_payout'
         ORDER BY created_at DESC LIMIT 1`
      );
      const details = typeof audit.rows[0].details === 'string'
        ? JSON.parse(audit.rows[0].details)
        : audit.rows[0].details;

      expect(details.body.otp_code).toBe('[masqué]');
      expect(details.body.amount).toBe(amount);
    } finally {
      // Voir le commentaire equivalent dans le test precedent : si le
      // decaissement n'a pas abouti (pas de transaction en retour), le credit
      // artificiel de creditPlatform doit etre retire directement.
      if (res.body.transaction) {
        await reversePayout(res.body.transaction);
      } else {
        await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, platformUserId]);
      }
    }
  });

  it('refuse un mauvais code sans rien deplacer', async () => {
    const amount = 7000;
    await creditPlatform(amount);
    const before = await balanceOf(platformUserId);

    await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount });

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, otp_code: '000000' });

    // try/finally : creditPlatform a deja ajoute amount au wallet plateforme
    // avant meme la requete ; ce credit doit etre retire quoi qu'il arrive
    // ci-dessous, meme si l'assertion de solde echoue a cause d'une autre
    // suite qui touche le meme compte au meme instant.
    try {
      expect(res.statusCode).toBe(401);
      expect(res.body.otp_invalid).toBe(true);
      expect(await balanceOf(platformUserId)).toBe(before);
    } finally {
      await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, platformUserId]);
    }
  });

  it('refuse un montant superieur au solde plateforme', async () => {
    const platformBalance = await balanceOf(platformUserId);
    const amount = Math.round(platformBalance) + 1000;

    await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount });

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, otp_code: lastOtpCode() });

    // try/finally : platformBalance est lu au tout debut du test, avant les
    // deux requetes. Si une autre suite credite la plateforme entre-temps, le
    // solde reel au moment du controleur peut depasser `amount` et le
    // decaissement peut reussir malgre l'intention du test — auquel cas une
    // vraie transaction a deplace de l'argent reel (pas invente par
    // creditPlatform, contrairement aux autres tests) et doit etre annulee
    // symetriquement des deux cotes : reversePayout ne suffit pas ici, elle
    // ne retire que le gain du beneficiaire et laisserait la plateforme
    // durablement debitee.
    try {
      expect(res.statusCode).toBe(400);
      expect(res.body.balance).toBe(platformBalance);
      expect(res.body.amount).toBe(amount);
      expect(await balanceOf(platformUserId)).toBe(platformBalance);
    } finally {
      if (res.body.transaction) {
        await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amount, platformUserId]);
        await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, destinationUserId]);
        await pool.query('DELETE FROM transactions WHERE id = $1', [res.body.transaction.id]);
      }
    }
  });

  it('refuse les montants invalides sans envoyer de SMS', async () => {
    for (const amount of [0, -100, 1500.5, 'beaucoup']) {
      const res = await request(app)
        .post('/api/admin/payout')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount });

      expect(res.statusCode).toBe(400);
    }

    expect(sendOtpSMS).not.toHaveBeenCalled();
  });
});
