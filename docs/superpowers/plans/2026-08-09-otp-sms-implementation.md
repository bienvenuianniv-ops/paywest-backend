# OTP SMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exiger un code à usage unique envoyé par SMS pour tout transfert (`/api/transactions/send`) ou retrait (`/api/withdraw/wave`, `/api/withdraw/orange`) de plus de 100 000 XOF, pour limiter les dégâts d'un JWT volé.

**Architecture:** Un middleware `requireOtp(purpose)` inséré dans la chaîne existante des 3 routes concernées, juste après `checkTransactionLimits`. Sous le seuil, il ne fait rien. Au-dessus, il gère un cycle défi/réponse : pas de `otp_code` dans le body → génère un code, l'enregistre (hashé) lié à `sha256(amount+destinataire)`, l'envoie par SMS au numéro **du compte** (pas du destinataire), répond 403. `otp_code` fourni → vérifie contre la ligne active correspondant exactement à ce montant+destinataire ; correct → laisse passer ; faux/expiré/déjà utilisé/verrouillé → 401. Une route `POST /api/otp/resend` permet de redemander un SMS (cooldown 60s). Un bug d'interaction avec `idempotency.js` (mise en cache d'une réponse de défi OTP) est corrigé au passage.

**Tech Stack:** Express 5, PostgreSQL (`pg`), `bcryptjs` pour le hash du code, `crypto` (natif Node) pour le hash de liaison, Jest + Supertest contre la base réelle `paywest_test`.

## Global Constraints

- Seuil de déclenchement : **100 000 XOF**, fixe, identique pour tous les rôles (spec `docs/superpowers/specs/2026-08-09-otp-sms-design.md`).
- Code à 6 chiffres, expiration **5 minutes**, **3 tentatives** max par code, cooldown de **60 secondes** entre deux renvois.
- Aucune nouvelle route pour les 3 endpoints existants — uniquement un champ optionnel `otp_code` dans le body.
- Le SMS part vers le numéro **enregistré du compte appelant** (`users.phone`), jamais vers un numéro fourni dans le body — sinon la protection est contournable en pointant le SMS vers le téléphone de l'attaquant.
- Toute réponse de défi/rejet OTP (`otp_required`/`otp_invalid`) ne doit **jamais** être mise en cache par le middleware `idempotency`.
- Pas de framework de migration dans ce repo (contrairement à mairie-rdv) : le DDL de `otp_codes` s'applique directement en base, comme `idempotency_keys` avant lui — aucun fichier de migration à créer.
- Style DB : `INTEGER` pour les clés, `VARCHAR` pour les chaînes, `TIMESTAMP` (sans fuseau) pour les dates — cohérent avec `idempotency_keys`/`users` existants.

---

### Task 1: Créer la table `otp_codes` (prod + test)

**Files:** aucun fichier — DDL appliqué directement en base, comme `idempotency_keys`.

**Interfaces:**
- Produces: table `otp_codes(id, user_id, purpose, code_hash, binding_hash, attempts, expires_at, used_at, created_at)`, utilisée par toutes les tâches suivantes.

- [ ] **Step 1: Créer la table sur `paywest_test`**

Depuis `C:\Users\Dell\paywest-backend` :

```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: true } });
pool.query(\`
  CREATE TABLE otp_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    purpose VARCHAR(50) NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    binding_hash VARCHAR(64) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_otp_codes_lookup ON otp_codes (user_id, purpose, binding_hash);
\`).then(() => { console.log('OK test'); pool.end(); }).catch(e => { console.log('ERR', e.message); pool.end(); });
"
```

Expected: `OK test` affiché, aucune erreur.

- [ ] **Step 2: Vérifier la table sur `paywest_test`**

```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: true } });
pool.query(\"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'otp_codes' ORDER BY ordinal_position\").then(r => { console.log(r.rows); pool.end(); }).catch(e => { console.log('ERR', e.message); pool.end(); });
"
```

Expected: 9 colonnes listées (`id, user_id, purpose, code_hash, binding_hash, attempts, expires_at, used_at, created_at`).

- [ ] **Step 3: Créer la même table sur la base de production**

Même commande que Step 1, en remplaçant `process.env.TEST_DATABASE_URL` par `process.env.DATABASE_URL`.

- [ ] **Step 4: Vérifier la table en production**

Même commande que Step 2, avec `process.env.DATABASE_URL`.

Expected: mêmes 9 colonnes.

Pas de commit pour cette tâche (aucun fichier modifié).

---

### Task 2: Middleware `requireOtp` + intégration sur `/api/transactions/send`

**Files:**
- Create: `src/middleware/requireOtp.js`
- Modify: `src/config/sms.js` (ajout de `sendOtpSMS`)
- Modify: `src/routes/transactionRoutes.js:6-8,39`
- Test: `src/tests/otp.test.js`

**Interfaces:**
- Consumes: `pool` (`../config/db`, export par défaut = instance `pg.Pool`), `logger` (`../config/logger`, méthodes `.info/.warn/.error`), `sendSMS(phone, message)` (`../config/sms`).
- Produces (utilisé par Task 3, Task 5) :
  - `requireOtp(purpose: string) => (req, res, next) => Promise<void>` — middleware Express.
  - `computeBindingHash(purpose: string, body: object) => string` — sha256 hex.
  - `generateAndSendOtp(userId: number, purpose: string, bindingHash: string) => Promise<void>`.
  - `isValidPurpose(purpose: string) => boolean`.
  - `OTP_THRESHOLD = 100000`, `RESEND_COOLDOWN_MS = 60000` (constantes exportées).
  - `sendOtpSMS(phone: string, code: string) => Promise<any>` exporté par `src/config/sms.js`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/tests/otp.test.js` :

```javascript
const request = require('supertest');

jest.mock('../../src/config/sms', () => {
  const actual = jest.requireActual('../../src/config/sms');
  return { ...actual, sendOtpSMS: jest.fn().mockResolvedValue(undefined) };
});

const { sendOtpSMS } = require('../../src/config/sms');
const app = require('../../src/index');
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
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
NODE_ENV=test npx jest src/tests/otp.test.js
```

Expected: FAIL — `Cannot find module '../../src/config/sms'` exportant `sendOtpSMS`, ou les transferts à 150000 XOF passent en 200/404 sans jamais renvoyer 403 (le middleware n'existe pas encore).

- [ ] **Step 3: Ajouter `sendOtpSMS` dans `src/config/sms.js`**

Ajouter avant `module.exports` (après `sendWithdrawSMS`) :

```javascript
const sendOtpSMS = async (phone, code) => {
  const message = `PayWest: Votre code de confirmation est ${code}. Valable 5 minutes. Ne le partagez avec personne.`;
  return sendSMS(phone, message);
};
```

Modifier la ligne `module.exports` en :

```javascript
module.exports = { sendSMS, sendWelcomeSMS, sendTransferSMS, sendDepositSMS, sendWithdrawSMS, sendOtpSMS };
```

- [ ] **Step 4: Créer `src/middleware/requireOtp.js`**

```javascript
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const logger = require('../config/logger');
const { sendOtpSMS } = require('../config/sms');

const OTP_THRESHOLD = 100000;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RESEND_COOLDOWN_MS = 60 * 1000;

// Champs du body qui identifient de maniere unique une transaction pour
// chaque purpose — lient le code OTP a CE montant + CE destinataire precis,
// pour qu'un code obtenu pour une transaction ne puisse pas en autoriser
// une autre.
const BINDING_FIELDS = {
  'transactions.send': (body) => `${body.amount}:${body.receiver_phone}`,
  'withdraw.wave': (body) => `${body.amount}:${body.phone}`,
  'withdraw.orange': (body) => `${body.amount}:${body.phone}`
};

const isValidPurpose = (purpose) => Object.prototype.hasOwnProperty.call(BINDING_FIELDS, purpose);

const computeBindingHash = (purpose, body) => {
  const raw = BINDING_FIELDS[purpose](body);
  return crypto.createHash('sha256').update(raw).digest('hex');
};

// Invalide tout code actif pour ce binding, en genere et en envoie un
// nouveau par SMS au numero enregistre du compte (jamais a un numero
// fourni dans le body, sinon un attaquant avec un JWT vole pourrait
// simplement recevoir le code lui-meme).
const generateAndSendOtp = async (userId, purpose, bindingHash) => {
  await pool.query(
    'DELETE FROM otp_codes WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3',
    [userId, purpose, bindingHash]
  );

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await pool.query(
    `INSERT INTO otp_codes (user_id, purpose, code_hash, binding_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, purpose, codeHash, bindingHash, expiresAt]
  );

  const userResult = await pool.query('SELECT phone FROM users WHERE id = $1', [userId]);

  try {
    await sendOtpSMS(userResult.rows[0].phone, code);
  } catch (error) {
    logger.error('Erreur envoi SMS OTP', { error: error.message, userId, purpose });
  }
};

const requireOtp = (purpose) => async (req, res, next) => {
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= OTP_THRESHOLD) {
    return next();
  }

  const userId = req.user.id;
  const bindingHash = computeBindingHash(purpose, req.body);
  const otpCode = req.body.otp_code;

  try {
    if (!otpCode) {
      await generateAndSendOtp(userId, purpose, bindingHash);
      return res.status(403).json({
        otp_required: true,
        message: 'Code envoyé par SMS, valable 5 minutes.'
      });
    }

    // Un code a-t-il deja ete emis pour EXACTEMENT ce montant+destinataire ?
    // Si non (le client a change le montant/destinataire entre-temps, ou
    // fourni un code d'une autre transaction), on traite comme "aucun code
    // fourni" plutot que "code invalide" : nouveau defi, nouveau SMS.
    const everIssued = await pool.query(
      'SELECT 1 FROM otp_codes WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3 LIMIT 1',
      [userId, purpose, bindingHash]
    );

    if (everIssued.rows.length === 0) {
      await generateAndSendOtp(userId, purpose, bindingHash);
      return res.status(403).json({
        otp_required: true,
        message: 'Code envoyé par SMS, valable 5 minutes.'
      });
    }

    const active = await pool.query(
      `SELECT * FROM otp_codes
       WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3
       AND used_at IS NULL AND expires_at > NOW() AND attempts < $4
       ORDER BY created_at DESC LIMIT 1`,
      [userId, purpose, bindingHash, MAX_ATTEMPTS]
    );

    if (active.rows.length === 0) {
      return res.status(401).json({
        otp_invalid: true,
        message: 'Code invalide ou expiré. Demandez un nouveau code.'
      });
    }

    const otpRow = active.rows[0];
    const isMatch = await bcrypt.compare(String(otpCode), otpRow.code_hash);

    if (!isMatch) {
      await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otpRow.id]);
      return res.status(401).json({
        otp_invalid: true,
        message: 'Code invalide ou expiré. Demandez un nouveau code.'
      });
    }

    await pool.query('UPDATE otp_codes SET used_at = NOW() WHERE id = $1', [otpRow.id]);
    next();

  } catch (error) {
    logger.error('Erreur vérification OTP', { error: error.message, userId, purpose });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = {
  requireOtp,
  computeBindingHash,
  generateAndSendOtp,
  isValidPurpose,
  OTP_THRESHOLD,
  RESEND_COOLDOWN_MS
};
```

- [ ] **Step 5: Intégrer le middleware dans `src/routes/transactionRoutes.js`**

Ajouter l'import (après la ligne `const { idempotency } = require('../middleware/idempotency');`) :

```javascript
const { requireOtp } = require('../middleware/requireOtp');
```

Modifier la ligne de route `/send` :

```javascript
router.post('/send', verifyToken, idempotency('transactions.send'), transferRules, validate, checkTransactionLimits, requireOtp('transactions.send'), sendMoney);
```

- [ ] **Step 6: Lancer les tests et vérifier qu'ils passent**

```bash
NODE_ENV=test npx jest src/tests/otp.test.js
```

Expected: PASS — 7 tests verts.

- [ ] **Step 7: Lancer toute la suite pour vérifier l'absence de régression**

```bash
NODE_ENV=test npm test
```

Expected: tous les tests existants (`auth`, `wallet`, `kyc`, `agent`, `transaction`) restent verts — en particulier `transaction.test.js` (montants ≤ 100 XOF, jamais concernés par le seuil OTP).

- [ ] **Step 8: Commit**

```bash
git add src/config/sms.js src/middleware/requireOtp.js src/routes/transactionRoutes.js src/tests/otp.test.js
git commit -m "PayWest - OTP SMS sur les transferts au-dessus de 100k XOF

Nouveau middleware requireOtp(purpose), branche sur POST /api/transactions/send.
Code a 6 chiffres, hashe (bcrypt), lie a sha256(montant+destinataire),
expire en 5 min, verrouille apres 3 mauvais essais. Envoye au numero
enregistre du compte appelant, jamais a un numero fourni dans le body.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Intégration sur `/api/withdraw/wave` et `/api/withdraw/orange`

**Files:**
- Modify: `src/routes/withdrawRoutes.js:6-8,38,68`
- Test: `src/tests/otp.test.js` (ajout de tests)

**Interfaces:**
- Consumes: `requireOtp`, `OTP_THRESHOLD` (`../middleware/requireOtp`, produits par Task 2).

- [ ] **Step 1: Ajouter les tests pour les retraits**

Ajouter dans `src/tests/otp.test.js`, avant la fermeture du fichier (nouveau `describe` au même niveau que celui de la Task 2) :

```javascript
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
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
NODE_ENV=test npx jest src/tests/otp.test.js
```

Expected: FAIL sur les 2 nouveaux tests — `/api/withdraw/wave` renvoie 200 direct sans jamais demander de code.

- [ ] **Step 3: Intégrer le middleware dans `src/routes/withdrawRoutes.js`**

Ajouter l'import (après `const { idempotency } = require('../middleware/idempotency');`) :

```javascript
const { requireOtp } = require('../middleware/requireOtp');
```

Modifier les deux routes :

```javascript
router.post('/wave', verifyToken, idempotency('withdraw.wave'), depositRules, validate, checkTransactionLimits, requireOtp('withdraw.wave'), withdrawToWave);
```

```javascript
router.post('/orange', verifyToken, idempotency('withdraw.orange'), depositRules, validate, checkTransactionLimits, requireOtp('withdraw.orange'), withdrawToOrange);
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

```bash
NODE_ENV=test npx jest src/tests/otp.test.js
```

Expected: PASS — 9 tests verts au total.

- [ ] **Step 5: Lancer toute la suite**

```bash
NODE_ENV=test npm test
```

Expected: tous les tests verts, aucune régression.

- [ ] **Step 6: Commit**

```bash
git add src/routes/withdrawRoutes.js src/tests/otp.test.js
git commit -m "PayWest - OTP SMS sur les retraits Wave/Orange au-dessus de 100k XOF

Reutilise requireOtp() de la Task 2 sur POST /api/withdraw/wave et
POST /api/withdraw/orange, avec des purposes distincts pour ne pas
melanger les codes entre les deux operateurs.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Fix de l'interaction `idempotency.js` × OTP

**Files:**
- Modify: `src/middleware/idempotency.js:52-67`
- Test: `src/tests/otp.test.js` (ajout d'un test)

**Interfaces:** aucune nouvelle interface — modification interne du wrapper `res.json`.

- [ ] **Step 1: Écrire le test qui reproduit le bug**

Ajouter dans `src/tests/otp.test.js`, dans le `describe('OTP SMS — /api/transactions/send', ...)` :

```javascript
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

    await reverseTransfer(executed.body.transaction.sender_id, RECEIVER_PHONE, 150000);
    await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
  });
```

- [ ] **Step 2: Lancer le test et vérifier qu'il échoue**

```bash
NODE_ENV=test npx jest src/tests/otp.test.js -t "Idempotency-Key"
```

Expected: FAIL — le 2e appel renvoie `403` (la réponse du défi initial est renvoyée depuis le cache d'idempotence), pas `200`.

- [ ] **Step 3: Corriger `src/middleware/idempotency.js`**

Remplacer le bloc (lignes 52-67 actuelles) :

```javascript
    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      // Attendre que la reponse soit persistee AVANT de l'envoyer au client :
      // sinon un retry tres rapide peut arriver avant que la ligne soit
      // marquee "traitee", et recevoir un 409 au lieu de la reponse en cache.
      try {
        await pool.query(
          `UPDATE idempotency_keys SET response_status = $1, response_body = $2
           WHERE user_id = $3 AND key = $4 AND endpoint = $5`,
          [res.statusCode, body, userId, key, label]
        );
      } catch (error) {
        logger.error('Erreur sauvegarde idempotency', { error: error.message });
      }
      return originalJson(body);
    };
```

par :

```javascript
    const originalJson = res.json.bind(res);
    res.json = async (body) => {
      // Un defi OTP (otp_required/otp_invalid) n'est pas une issue finale :
      // la transaction n'a pas eu lieu. Le mettre en cache bloquerait pour
      // toujours une resoumission avec la meme Idempotency-Key et le bon
      // code, puisque la reponse en cache serait renvoyee sans jamais
      // re-executer requireOtp.
      const isOtpChallenge = body && (body.otp_required === true || body.otp_invalid === true);

      if (isOtpChallenge) {
        return originalJson(body);
      }

      // Attendre que la reponse soit persistee AVANT de l'envoyer au client :
      // sinon un retry tres rapide peut arriver avant que la ligne soit
      // marquee "traitee", et recevoir un 409 au lieu de la reponse en cache.
      try {
        await pool.query(
          `UPDATE idempotency_keys SET response_status = $1, response_body = $2
           WHERE user_id = $3 AND key = $4 AND endpoint = $5`,
          [res.statusCode, body, userId, key, label]
        );
      } catch (error) {
        logger.error('Erreur sauvegarde idempotency', { error: error.message });
      }
      return originalJson(body);
    };
```

- [ ] **Step 4: Lancer le test et vérifier qu'il passe**

```bash
NODE_ENV=test npx jest src/tests/otp.test.js
```

Expected: PASS — tous les tests d'`otp.test.js` verts.

- [ ] **Step 5: Lancer toute la suite**

```bash
NODE_ENV=test npm test
```

Expected: tous les tests verts, aucune régression (en particulier le comportement normal de l'idempotency-key sur une transaction sous le seuil, déjà couvert implicitement par les tests existants qui n'envoient jamais de header `Idempotency-Key`).

- [ ] **Step 6: Commit**

```bash
git add src/middleware/idempotency.js src/tests/otp.test.js
git commit -m "PayWest - fix idempotency.js qui mettait en cache les defis OTP

Une reponse otp_required/otp_invalid n'est pas une issue finale de la
transaction. La mettre en cache sous une Idempotency-Key bloquait pour
toujours une resoumission legitime avec le bon code : le client aurait
recu indefiniment le 403 initial au lieu de voir sa transaction s'executer.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Route `POST /api/otp/resend`

**Files:**
- Create: `src/controllers/otpController.js`
- Create: `src/routes/otpRoutes.js`
- Modify: `src/index.js:19-25` (imports + montage de la route)
- Test: `src/tests/otp.test.js` (nouveau `describe`)

**Interfaces:**
- Consumes: `generateAndSendOtp`, `isValidPurpose`, `RESEND_COOLDOWN_MS` (`../middleware/requireOtp`, produits par Task 2), `pool`, `logger`, `verifyToken` (`../middleware/authMiddleware`).
- Produces: `POST /api/otp/resend` — body `{ purpose, amount, receiver_phone|phone }`, réponses `200 { message }`, `400 { message }`, `429 { message }`.

- [ ] **Step 1: Écrire les tests**

Ajouter dans `src/tests/otp.test.js` :

```javascript
describe('POST /api/otp/resend', () => {

  afterEach(async () => {
    await pool.query('DELETE FROM otp_codes WHERE purpose = $1', ['transactions.send']);
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
    await reverseTransfer(withNewCode.body.transaction.sender_id, RECEIVER_PHONE, 150000);
  });

  it('applique un cooldown de 60s entre deux renvois', async () => {
    await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'transactions.send', amount: 150000, receiver_phone: RECEIVER_PHONE });

    const res = await request(app)
      .post('/api/otp/resend')
      .set('Authorization', `Bearer ${token}`)
      .send({ purpose: 'transactions.send', amount: 150000, receiver_phone: RECEIVER_PHONE });

    expect(res.statusCode).toBe(429);
  });

});
```

- [ ] **Step 2: Lancer les tests et vérifier qu'ils échouent**

```bash
NODE_ENV=test npx jest src/tests/otp.test.js
```

Expected: FAIL avec `Cannot POST /api/otp/resend` (404) — la route n'existe pas encore.

- [ ] **Step 3: Créer `src/controllers/otpController.js`**

```javascript
const pool = require('../config/db');
const logger = require('../config/logger');
const {
  computeBindingHash,
  generateAndSendOtp,
  isValidPurpose,
  RESEND_COOLDOWN_MS
} = require('../middleware/requireOtp');

const resendOtp = async (req, res) => {
  const { purpose, amount } = req.body;

  if (!isValidPurpose(purpose)) {
    return res.status(400).json({ message: 'Motif (purpose) invalide' });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const targetField = purpose === 'transactions.send' ? 'receiver_phone' : 'phone';
  if (!req.body[targetField] || typeof req.body[targetField] !== 'string') {
    return res.status(400).json({ message: `Le champ ${targetField} est obligatoire` });
  }

  const userId = req.user.id;
  const bindingHash = computeBindingHash(purpose, req.body);

  try {
    const last = await pool.query(
      `SELECT created_at FROM otp_codes
       WHERE user_id = $1 AND purpose = $2 AND binding_hash = $3
       ORDER BY created_at DESC LIMIT 1`,
      [userId, purpose, bindingHash]
    );

    if (last.rows.length > 0) {
      const ageMs = Date.now() - new Date(last.rows[0].created_at).getTime();
      if (ageMs < RESEND_COOLDOWN_MS) {
        return res.status(429).json({ message: 'Veuillez patienter avant de redemander un code.' });
      }
    }

    await generateAndSendOtp(userId, purpose, bindingHash);
    res.json({ message: 'Nouveau code envoyé par SMS.' });

  } catch (error) {
    logger.error('Erreur renvoi OTP', { error: error.message, userId, purpose });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { resendOtp };
```

- [ ] **Step 4: Créer `src/routes/otpRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/authMiddleware');
const { resendOtp } = require('../controllers/otpController');

/**
 * @swagger
 * /api/otp/resend:
 *   post:
 *     summary: Renvoyer un code OTP par SMS pour une transaction en attente
 *     tags: [OTP]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [purpose, amount]
 *             properties:
 *               purpose:
 *                 type: string
 *                 enum: [transactions.send, withdraw.wave, withdraw.orange]
 *               amount:
 *                 type: integer
 *               receiver_phone:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nouveau code envoyé
 *       400:
 *         description: Motif ou montant invalide
 *       429:
 *         description: Cooldown actif
 */
router.post('/resend', verifyToken, resendOtp);

module.exports = router;
```

- [ ] **Step 5: Monter la route dans `src/index.js`**

Ajouter l'import (après `const reportRoutes = require('./routes/reportRoutes');`) :

```javascript
const otpRoutes = require('./routes/otpRoutes');
```

Ajouter le montage (après `app.use('/api/withdraw', transactionLimiter, withdrawRoutes);`) :

```javascript
app.use('/api/otp', transactionLimiter, otpRoutes);
```

- [ ] **Step 6: Lancer les tests et vérifier qu'ils passent**

```bash
NODE_ENV=test npx jest src/tests/otp.test.js
```

Expected: PASS — tous les tests d'`otp.test.js` verts (13 au total).

- [ ] **Step 7: Lancer toute la suite**

```bash
NODE_ENV=test npm test
```

Expected: tous les tests verts, aucune régression.

- [ ] **Step 8: Commit**

```bash
git add src/controllers/otpController.js src/routes/otpRoutes.js src/index.js src/tests/otp.test.js
git commit -m "PayWest - route POST /api/otp/resend

Permet de redemander un SMS si le premier n'arrive pas, avec un
cooldown de 60s par utilisateur+purpose pour eviter l'abus (cout SMS).
Reutilise generateAndSendOtp/computeBindingHash du middleware requireOtp.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Vérification manuelle en conditions réelles + nettoyage

**Files:** aucun fichier — vérification uniquement.

- [ ] **Step 1: Démarrer le serveur en local**

```bash
node src/index.js
```

Expected: `Serveur PayWest démarré sur le port 5000` puis `✅ PostgreSQL Neon connecté avec succès !`, sans erreur.

- [ ] **Step 2: Se connecter et tenter un transfert au-dessus du seuil**

```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bienvenu@paywest.com","password":"'"$TEST_PASSWORD"'"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

curl -s -X POST http://localhost:5000/api/transactions/send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"receiver_phone":"+221770000001","amount":150000}'
```

Expected : `{"otp_required":true,"message":"Code envoyé par SMS, valable 5 minutes."}`. Comme `AFRICASTALKING_USERNAME=sandbox` en local, le SMS ne part pas réellement — récupérer le code directement en base pour terminer la vérification :

```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
pool.query(\"SELECT id, code_hash FROM otp_codes WHERE purpose = 'transactions.send' ORDER BY created_at DESC LIMIT 1\").then(r => { console.log(r.rows[0]); pool.end(); });
"
```

Le `code_hash` étant un hash bcrypt, il n'est pas lisible directement — pour ce test manuel, ajouter temporairement un `console.log(code)` juste après sa génération dans `generateAndSendOtp` (Task 2, `requireOtp.js`), relire les logs du serveur, **puis retirer ce `console.log` avant de continuer** (ne jamais logger un code OTP en clair en production).

- [ ] **Step 3: Terminer le transfert avec le code récupéré**

```bash
curl -s -X POST http://localhost:5000/api/transactions/send \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"receiver_phone":"+221770000001","amount":150000,"otp_code":"<code relevé>"}'
```

Expected: `200`, objet `transaction` retourné.

- [ ] **Step 4: Nettoyer les données créées par la vérification manuelle**

```bash
node -e "
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
(async () => {
  const admin = await pool.query(\"SELECT id FROM users WHERE email = 'bienvenu@paywest.com'\");
  const receiver = await pool.query(\"SELECT id FROM users WHERE phone = '+221770000001'\");
  await pool.query('UPDATE wallets SET balance = balance + 150000 WHERE user_id = \$1', [admin.rows[0].id]);
  await pool.query('UPDATE wallets SET balance = balance - 150000 WHERE user_id = \$1', [receiver.rows[0].id]);
  await pool.query(\"DELETE FROM transactions WHERE sender_id = \$1 AND type = 'transfer' AND amount = 150000\", [admin.rows[0].id]);
  await pool.query(\"DELETE FROM otp_codes WHERE user_id = \$1\", [admin.rows[0].id]);
  console.log('Nettoyage OK');
  pool.end();
})();
"
```

Expected: `Nettoyage OK`, soldes admin/destinataire revenus à leur valeur d'avant le test.

- [ ] **Step 5: Arrêter le serveur local**

`Ctrl+C` sur le process lancé au Step 1.

Pas de commit pour cette tâche (vérification uniquement, aucun fichier modifié — sauf si le `console.log` temporaire du Step 2 a été oublié : vérifier `git diff src/middleware/requireOtp.js` avant de passer à autre chose).
