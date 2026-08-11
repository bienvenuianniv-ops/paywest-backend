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

// Le solde du wallet plateforme est credite en frais par toutes les autres
// suites qui tournent en parallele : toute egalite stricte dessus est
// instable par construction. Le nombre de transactions type='payout', en
// revanche, n'est modifie par aucune autre suite — c'est un invariant
// deterministe.
const payoutCount = async () => {
  const res = await pool.query(`SELECT COUNT(*) FROM transactions WHERE type = 'payout'`);
  return parseInt(res.rows[0].count, 10);
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

// Le beneficiaire de test doit etre une ligne que personne d'autre ne touche :
// PAYOUT_DESTINATION_EMAIL (en test uniquement — la prod garde le vrai compte
// PayWest) pointe vers un compte dedie, inactif, qu'aucune autre suite ne
// credite ni ne debite. Sans ca, les assertions de solde sur ce compte
// deviennent une course avec les autres workers Jest qui tournent en
// parallele sur la meme base paywest_test — c'est exactement ce qui causait
// des echecs intermittents quand PAYOUT_DESTINATION_EMAIL pointait vers le
// compte admin partage. Cree ici de facon idempotente (ON CONFLICT DO
// NOTHING), sur le modele du compte plateforme d'initDb.js : mot de passe '*'
// donc non connectable, telephone non numerique donc impossible a viser comme
// destinataire d'un transfert.
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

  await pool.query(
    `INSERT INTO users (full_name, email, phone, password, role)
     VALUES ('PayWest Destination Test', $1, 'PAYOUT-DEST-TEST', '*', 'customer')
     ON CONFLICT (email) DO NOTHING`,
    [process.env.PAYOUT_DESTINATION_EMAIL]
  );

  const destination = await pool.query('SELECT id FROM users WHERE email = $1', [
    process.env.PAYOUT_DESTINATION_EMAIL
  ]);
  destinationUserId = destination.rows[0].id;

  await pool.query(
    `INSERT INTO wallets (user_id, balance, currency)
     VALUES ($1, 0, 'XOF')
     ON CONFLICT (user_id) DO NOTHING`,
    [destinationUserId]
  );
});

describe('GET /api/admin/platform-balance', () => {

  it('renvoie le solde du wallet plateforme a un admin', async () => {
    // Pas d'egalite stricte sur une valeur lue separement avant l'appel :
    // meme raison que partout ailleurs dans ce fichier — le solde plateforme
    // est credite en frais par d'autres suites en parallele, une comparaison
    // a une lecture prise avant la requete est une course. On verifie la
    // forme de la reponse (bon compte, type numerique fini, bonne devise),
    // ce qui suffit a couvrir un bug de requete (mauvaise colonne, mauvais
    // wallet) sans dependre d'un instantane figé.
    const res = await request(app)
      .get('/api/admin/platform-balance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.platform_user_id).toBe(platformUserId);
    expect(typeof res.body.balance).toBe('number');
    expect(Number.isFinite(res.body.balance)).toBe(true);
    expect(res.body.currency).toBe('XOF');
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
    const before = await payoutCount();

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ amount: 1000 });

    expect(res.statusCode).toBe(403);
    expect(await payoutCount()).toBe(before);
  });

  it('exige un code OTP meme pour 1 XOF', async () => {
    const before = await payoutCount();

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 1 });

    expect(res.statusCode).toBe(403);
    expect(res.body.otp_required).toBe(true);
    expect(sendOtpSMS).toHaveBeenCalledTimes(1);
    expect(await payoutCount()).toBe(before);
  });

  it('deplace l argent vers le beneficiaire avec le bon code', async () => {
    const amount = 5000;
    await creditPlatform(amount);

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
    //
    // Pas d'egalite stricte sur le solde plateforme : d'autres suites le
    // creditent en frais en parallele, ce solde est instable par
    // construction. destinationUserId, lui, est le compte de test dedie —
    // aucune autre suite n'y touche, l'egalite stricte y est sure.
    try {
      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.type).toBe('payout');
      expect(res.body.transaction.status).toBe('completed');
      expect(res.body.transaction.sender_id).toBe(platformUserId);
      expect(res.body.transaction.receiver_id).toBe(destinationUserId);

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
    const before = await payoutCount();

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
    // ci-dessous, meme si l'assertion echoue. payoutCount() (et non le solde
    // plateforme absolu) est l'invariant sur : aucune autre suite ne cree de
    // transaction type='payout'.
    try {
      expect(res.statusCode).toBe(401);
      expect(res.body.otp_invalid).toBe(true);
      expect(await payoutCount()).toBe(before);
    } finally {
      await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, platformUserId]);
    }
  });

  it('refuse un montant superieur au solde plateforme', async () => {
    // Pas de "solde actuel + 1000" : entre la lecture et l'appel, un frais
    // concurrent peut faire passer le solde au-dessus de ce montant et le
    // decaissement reussirait alors vraiment. Un montant absurdement grand
    // reste hors de portee quoi que fassent les autres suites en parallele.
    const amount = 999999999;
    const before = await payoutCount();

    await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount });

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, otp_code: lastOtpCode() });

    // try/finally conserve par prudence : si jamais ce montant devenait un
    // jour payable (ne devrait jamais arriver vu sa taille), une vraie
    // transaction aurait deplace de l'argent reel et doit etre annulee
    // symetriquement des deux cotes — reversePayout seule ne retire que le
    // gain du beneficiaire et laisserait la plateforme durablement debitee.
    try {
      expect(res.statusCode).toBe(400);
      expect(res.body.amount).toBe(amount);
      expect(await payoutCount()).toBe(before);
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
