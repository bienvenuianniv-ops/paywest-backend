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

// Solde du wallet plateforme ET plus grand id de transaction, lus dans le
// meme instantane. C'est l'appariement qui compte : un transfert insere sa
// ligne et credite les frais dans une seule transaction SQL, les deux
// deviennent donc visibles ensemble. Deux requetes separees pourraient voir
// le credit sans voir la ligne, et le bruit mesure ci-dessous serait faux.
const platformSnapshot = async () => {
  const res = await pool.query(
    `SELECT (SELECT balance FROM wallets WHERE user_id = $1) AS balance,
            (SELECT COALESCE(MAX(id), 0) FROM transactions) AS max_tx_id`,
    [platformUserId]
  );
  return {
    balance: parseFloat(res.rows[0].balance),
    maxTxId: parseInt(res.rows[0].max_tx_id, 10)
  };
};

// Frais credites au wallet plateforme par les autres suites entre deux
// instantanes. Le decaissement lui-meme a fee = 0 et n'entre donc pas dans
// cette somme, meme si sa ligne tombe dans l'intervalle.
const feesCreditedBetween = async (fromTxId, toTxId) => {
  const res = await pool.query(
    `SELECT COALESCE(SUM(fee), 0) AS total FROM transactions WHERE id > $1 AND id <= $2`,
    [fromTxId, toTxId]
  );
  return parseFloat(res.rows[0].total);
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
// PAYOUT_DESTINATION_EMAIL pointe vers le compte tresorerie, dedie et inactif,
// qu'aucune autre suite ne credite ni ne debite. Sans ca, les assertions de
// solde sur ce compte deviennent une course avec les autres workers Jest qui
// tournent en parallele sur la meme base paywest_test — c'est exactement ce
// qui causait des echecs intermittents quand PAYOUT_DESTINATION_EMAIL pointait
// vers le compte admin partage. Test et production designent desormais le meme
// compte (treasury@paywest.internal), ce qui supprime la divergence : la
// propriete qui rend ce compte sur en production — non connectable, hors
// d'atteinte des transferts — est celle-la meme qui le rend stable en test.
// La creation elle-meme (idempotente) vit desormais
// dans src/tests/setup.js, qui s'execute avant CHAQUE fichier de test :
// payoutDestination.test.js resout aussi cet email, et Jest n'ordonne pas les
// fichiers de test entre eux — la creer ici seulement laissait cette autre
// suite echouer si elle s'executait la premiere sur une base neuve.
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
    // Pas d'egalite stricte sur une valeur lue separement avant l'appel :
    // meme raison que partout ailleurs dans ce fichier — le solde plateforme
    // est credite en frais par d'autres suites en parallele, une comparaison
    // a une lecture prise avant la requete est une course. On encadre plutot
    // la valeur retournee par une lecture directe en base juste avant et
    // juste apres l'appel : comme aucune autre suite ne debite jamais ce
    // wallet (seulement des credits de frais), le solde ne peut qu'augmenter
    // pendant la fenetre — platformBefore <= res.body.balance <= platformAfter
    // est donc garanti sans course, et une route qui lirait le mauvais wallet
    // ferait echouer cet encadrement.
    const platformBefore = await balanceOf(platformUserId);

    const res = await request(app)
      .get('/api/admin/platform-balance')
      .set('Authorization', `Bearer ${adminToken}`);

    const platformAfter = await balanceOf(platformUserId);

    expect(res.statusCode).toBe(200);
    expect(res.body.platform_user_id).toBe(platformUserId);
    expect(typeof res.body.balance).toBe('number');
    expect(Number.isFinite(res.body.balance)).toBe(true);
    expect(res.body.currency).toBe('XOF');
    expect(res.body.balance).toBeGreaterThanOrEqual(platformBefore);
    expect(res.body.balance).toBeLessThanOrEqual(platformAfter);
  });

  // Contrepartie du choix d'un beneficiaire non connectable : le compte
  // tresorerie n'a pas de session, donc cette route est la SEULE fenetre sur
  // les revenus deja decaisses. Sans elle, l'argent sort du wallet plateforme
  // et devient invisible depuis l'application.
  it('renvoie aussi le solde du compte beneficiaire', async () => {
    // Egalite stricte assumee ici, contrairement au solde plateforme
    // ci-dessus : le wallet du beneficiaire n'est touche par aucune autre
    // suite, et Jest serialise les tests d'un meme fichier — la lecture prise
    // juste avant l'appel ne peut pas avoir bouge entre-temps.
    const destinationBefore = await balanceOf(destinationUserId);

    const res = await request(app)
      .get('/api/admin/platform-balance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.payout_destination).toBeTruthy();
    expect(res.body.payout_destination.user_id).toBe(destinationUserId);
    expect(res.body.payout_destination.balance).toBe(destinationBefore);
    expect(res.body.payout_destination.currency).toBe('XOF');

    // Le solde plateforme reste a la racine : la forme existante de la
    // reponse ne change pas, l'ajout est purement additif.
    expect(res.body.platform_user_id).toBe(platformUserId);
    expect(res.body.payout_destination.user_id).not.toBe(platformUserId);
  });

  it('lit le solde beneficiaire en direct et non une valeur figee', async () => {
    // Les assertions de forme ci-dessus passeraient encore si la route
    // renvoyait le wallet plateforme deux fois, ou une constante. On fait
    // donc bouger le seul wallet du beneficiaire et on verifie que la
    // reponse suit — sans toucher au wallet plateforme, dont la valeur doit
    // justement rester independante.
    const before = await request(app)
      .get('/api/admin/platform-balance')
      .set('Authorization', `Bearer ${adminToken}`);

    await pool.query('UPDATE wallets SET balance = balance + 5000 WHERE user_id = $1', [
      destinationUserId
    ]);

    try {
      const after = await request(app)
        .get('/api/admin/platform-balance')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(after.body.payout_destination.balance).toBe(
        before.body.payout_destination.balance + 5000
      );
    } finally {
      // Remise en etat meme si l'assertion echoue : la somme des wallets de
      // paywest_test doit etre strictement identique avant et apres le run.
      await pool.query('UPDATE wallets SET balance = balance - 5000 WHERE user_id = $1', [
        destinationUserId
      ]);
    }
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

    const platformBefore = await platformSnapshot();

    const res = await request(app)
      .post('/api/admin/payout')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount, otp_code: code });

    const platformAfter = await platformSnapshot();
    const feesDuringWindow = await feesCreditedBetween(platformBefore.maxTxId, platformAfter.maxTxId);

    // try/finally : d'autres suites de tests tournent en parallele sur les
    // memes comptes partages (plateforme, admin) et peuvent faire echouer une
    // assertion de solde par pure coincidence de timing. Sans ce filet, un
    // echec ici sauterait reversePayout et laisserait une derive permanente
    // dans paywest_test — inacceptable pour une route qui deplace de l'argent.
    //
    // Le solde du beneficiaire supporte l'egalite stricte : aucune autre suite
    // n'y touche. Celui de la plateforme, non — les autres suites le creditent
    // en frais pendant la fenetre. On ne se contente pas pour autant d'une
    // inegalite : les frais concurrents ne font qu'AUGMENTER ce solde, donc
    // toute borne du type `apres <= avant - montant` n'est vraie que quand
    // aucun frais n'est tombe, et `apres >= avant - montant` est vraie meme si
    // le debit a disparu. Les deux sont soit instables, soit vides.
    //
    // On mesure donc explicitement le bruit : platformSnapshot() lit le solde
    // et le plus grand id de transaction dans le MEME instantane, et un
    // transfert rend sa ligne et son credit de frais visibles ensemble (meme
    // transaction SQL). Les frais tombes pendant la fenetre sont donc
    // exactement ceux des transactions d'id compris entre les deux bornes, et
    // l'egalite ci-dessous est stricte malgre le parallelisme — un debit
    // supprime, inverse de signe, du mauvais montant ou pointe sur le mauvais
    // user_id la fait echouer.
    try {
      expect(res.statusCode).toBe(200);
      expect(res.body.transaction.type).toBe('payout');
      expect(res.body.transaction.status).toBe('completed');
      expect(res.body.transaction.sender_id).toBe(platformUserId);
      expect(res.body.transaction.receiver_id).toBe(destinationUserId);

      expect(await balanceOf(destinationUserId)).toBe(destinationBefore + amount);
      expect(platformAfter.balance).toBe(platformBefore.balance - amount + feesDuringWindow);
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
