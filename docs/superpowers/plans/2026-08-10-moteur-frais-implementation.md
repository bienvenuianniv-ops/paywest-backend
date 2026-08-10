# Moteur de frais sur transferts P2P — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prélever des frais sur les transferts P2P, à la charge de l'expéditeur, et les créditer sur un wallet plateforme dédié dans la même transaction SQL.

**Architecture:** Une fonction pure `computeFee()` isolée dans `src/services/feeService.js` détient la grille tarifaire en constante de code. `sendMoney` l'appelle hors transaction, puis débite l'expéditeur de `montant + frais`, crédite le destinataire du montant et le wallet plateforme des frais, avant d'insérer la ligne `transactions` porteuse de la colonne `fee`. Deux routes de consultation exposent la grille et un devis.

**Tech Stack:** Node/Express, PostgreSQL (Neon) via `pg`, Jest + supertest, `express-validator`.

**Spec de référence :** `docs/superpowers/specs/2026-08-10-moteur-frais-design.md`

## Global Constraints

- Barème par paliers, montants fixes en XOF : `0–5 000 → 100`, `5 001–25 000 → 250`, `25 001–50 000 → 500`, `50 001–100 000 → 1 000`, `100 001–500 000 → 2 500`, `> 500 000 → 5 000`.
- Les frais sont à la charge de **l'expéditeur, en plus du montant** : le destinataire reçoit le montant saisi exactement.
- Les frais sont crédités sur le wallet du compte `role = 'platform'`, dans la **même transaction SQL** que le transfert.
- `checkTransactionLimits`, `requireOtp` et `idempotency` ne sont **pas modifiés** : plafonds BCÉAO et seuil OTP continuent de porter sur `amount` seul.
- Seul `POST /api/transactions/send` est facturé. Dépôts, retraits et paiements marchands restent gratuits.
- Le nom de champ exposé pour le débit total est `total_debit`, identique dans le devis et dans la réponse de transfert.
- Les tests tournent contre `paywest_test` (`NODE_ENV=test`), jamais contre la production.
- `AUDIT.md` ne doit jamais être commité : vérifier `git status` avant chaque commit.
- **Le dépôt GitHub est public.** Aucun nouveau fichier de test ne doit contenir de mot de passe en dur, même en valeur de repli : les identifiants viennent de `process.env.TEST_PASSWORD`, qui doit être défini avant de lancer la suite.

---

### Task 1 : Service de calcul des frais

**Files:**
- Create: `src/services/feeService.js`
- Test: `src/tests/fees.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `computeFee(amount) → number` (entier XOF, lève une `Error` sur entrée invalide) et `FEE_TIERS` (tableau `{ min, max, fee }` ordonné par `max` croissant), consommés par les tâches 3 et 4.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/tests/fees.test.js`. Aucun accès base : ce fichier ne doit **pas** importer `src/index.js`, sinon il paie le coût d'une connexion Neon pour des tests purs.

```js
const { computeFee, FEE_TIERS } = require('../services/feeService');

describe('computeFee — paliers', () => {
  it.each([
    [1, 100],
    [5000, 100],
    [5001, 250],
    [25000, 250],
    [25001, 500],
    [50000, 500],
    [50001, 1000],
    [100000, 1000],
    [100001, 2500],
    [500000, 2500],
    [500001, 5000],
    [10000000, 5000]
  ])('facture %i XOF a %i XOF de frais', (amount, expected) => {
    expect(computeFee(amount)).toBe(expected);
  });

  // Les bornes sont le seul endroit ou une erreur de < au lieu de <= se voit.
  it('place 5000 dans le premier palier et 5001 dans le deuxieme', () => {
    expect(computeFee(5000)).toBe(100);
    expect(computeFee(5001)).toBe(250);
  });

  // Un montant decimal tombe "entre" deux paliers. L'API ne peut pas en
  // recevoir (le validateur impose isInt), mais computeFee est une fonction
  // publique du service : la selection se fait sur la borne haute seule pour
  // qu'aucun montant ne puisse rester sans palier. Defense en profondeur.
  it('applique le palier superieur a un montant entre deux paliers', () => {
    expect(computeFee(5000.5)).toBe(250);
    expect(computeFee(100000.75)).toBe(2500);
  });
});

describe('computeFee — entrees invalides', () => {
  it.each([[0], [-100], [NaN], [Infinity], ['abc'], [null], [undefined], [{}]])(
    'leve une erreur pour %p',
    (value) => {
      expect(() => computeFee(value)).toThrow('Montant invalide');
    }
  );
});

describe('FEE_TIERS', () => {
  it('est ordonne par borne haute croissante et sans trou', () => {
    for (let i = 1; i < FEE_TIERS.length; i++) {
      expect(FEE_TIERS[i].max).toBeGreaterThan(FEE_TIERS[i - 1].max);
      expect(FEE_TIERS[i].min).toBe(FEE_TIERS[i - 1].max + 1);
    }
  });

  it('couvre tous les montants jusqu a l infini', () => {
    expect(FEE_TIERS[FEE_TIERS.length - 1].max).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/tests/fees.test.js`
Expected: FAIL — `Cannot find module '../services/feeService'`

- [ ] **Step 3: Écrire l'implémentation minimale**

Créer `src/services/feeService.js` :

```js
// Grille tarifaire des transferts P2P (XOF).
//
// La grille vit ici, en constante de code, et non en base : elle est ainsi
// versionnee dans git, testable sans base, et aucune route admin ne peut
// modifier une regle monetaire (un compte admin compromis se fabriquerait
// sinon un bareme a 100 %). Voir la spec pour l'arbitrage complet.
//
// `min` n'est present que pour l'affichage de la grille via GET /api/fees.
// La SELECTION du palier se fait sur `max` seul : un montant tombant entre
// deux paliers (5000.5) ne correspondrait a aucune plage [min, max]. Le
// validateur de /send impose deja isInt, donc ce cas n'arrive pas par l'API —
// mais cette fonction est publique et ne doit jamais rendre "aucun palier".
const FEE_TIERS = [
  { min: 0,       max: 5000,     fee: 100  },
  { min: 5001,    max: 25000,    fee: 250  },
  { min: 25001,   max: 50000,    fee: 500  },
  { min: 50001,   max: 100000,   fee: 1000 },
  { min: 100001,  max: 500000,   fee: 2500 },
  { min: 500001,  max: Infinity, fee: 5000 }
];

const computeFee = (amount) => {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Montant invalide pour le calcul des frais');
  }

  const tier = FEE_TIERS.find((t) => value <= t.max);
  return tier.fee;
};

module.exports = { FEE_TIERS, computeFee };
```

Note : `Number(null)` vaut `0` et `Number({})` vaut `NaN` — les deux sont donc rejetés par la garde. `Number(Infinity)` est fini ? Non : `Number.isFinite(Infinity)` est `false`, rejeté également.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/tests/fees.test.js`
Expected: PASS, tous les cas verts.

- [ ] **Step 5: Commit**

```bash
git status --short
git add src/services/feeService.js src/tests/fees.test.js
git commit -m "feat(fees): service de calcul des frais par paliers"
```

---

### Task 2 : Schéma — colonne `fee` et compte plateforme

**Files:**
- Modify: `src/config/initDb.js`
- Create: `src/services/platformAccount.js`
- Modify: `src/index.js:95-99` (bloc `require.main === module`)
- Test: `src/tests/platformAccount.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `getPlatformUserId() → Promise<number>` et `resetPlatformCache() → void`, consommés par la tâche 4. Colonne `transactions.fee` (`DECIMAL(15,2) NOT NULL DEFAULT 0`).

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/tests/platformAccount.test.js` :

```js
const pool = require('../config/db');
const { getPlatformUserId, resetPlatformCache } = require('../services/platformAccount');

// Ne JAMAIS appeler pool.end() dans un fichier de test : `pool` est un
// singleton de module et Jest execute plusieurs fichiers dans le meme
// processus worker. Le premier a fermer le pool ferait echouer tous les
// suivants ("Cannot use a pool after calling end"). C'est la raison du
// `--forceExit` du script npm test.

describe('Compte plateforme', () => {
  it('existe avec un wallet et un role platform', async () => {
    const user = await pool.query(`SELECT id, phone, password FROM users WHERE role = 'platform'`);
    expect(user.rows).toHaveLength(1);

    // Non numerique : le validateur impose ^\+?[0-9]{8,15}$ sur phone et sur
    // receiver_phone, donc ce compte ne peut etre ni inscrit ni cible.
    expect(user.rows[0].phone).toBe('PLATFORM-ACCOUNT');
    // N'est pas un hash bcrypt valide : bcrypt.compare renverra toujours false.
    expect(user.rows[0].password).toBe('*');

    const wallet = await pool.query('SELECT id FROM wallets WHERE user_id = $1', [user.rows[0].id]);
    expect(wallet.rows).toHaveLength(1);
  });

  it('resout et memorise l id du compte', async () => {
    resetPlatformCache();
    const first = await getPlatformUserId();
    const second = await getPlatformUserId();
    expect(first).toBe(second);
    expect(Number.isInteger(first)).toBe(true);
  });
});

describe('Colonne fee', () => {
  it('existe sur transactions avec un defaut a 0', async () => {
    const column = await pool.query(`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name = 'fee'
    `);
    expect(column.rows).toHaveLength(1);
    expect(column.rows[0].is_nullable).toBe('NO');
    expect(column.rows[0].column_default).toContain('0');
  });

  it('vaut 0 sur toutes les lignes anterieures', async () => {
    const nulls = await pool.query('SELECT COUNT(*) FROM transactions WHERE fee IS NULL');
    expect(Number(nulls.rows[0].count)).toBe(0);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/tests/platformAccount.test.js`
Expected: FAIL — `Cannot find module '../services/platformAccount'`

- [ ] **Step 3: Ajouter la colonne et le seed dans `initDb.js`**

Dans `src/config/initDb.js`, ajouter à la fin du grand template SQL (après la table `otp_resend_cooldowns`) :

```sql
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee DECIMAL(15,2) NOT NULL DEFAULT 0;
```

Puis, **après** le bloc `DO $$ … wallets_user_id_key … END $$;` et **avant** le `console.log('✅ Tables créées avec succès !')`, insérer le seed. L'ordre est impératif : le `ON CONFLICT (user_id)` du wallet exige que la contrainte UNIQUE ait déjà été posée par le bloc précédent.

```js
    // Compte plateforme : destinataire des frais de transfert.
    //
    // password '*' n'est pas un hash bcrypt valide, donc bcrypt.compare
    // renvoie toujours false : le compte n'est connectable par personne.
    // phone non numerique : le validateur (^\+?[0-9]{8,15}$) rejette cette
    // valeur a l'inscription comme en destinataire de transfert.
    const platformInsert = await pool.query(`
      INSERT INTO users (full_name, email, phone, password, role)
      VALUES ('PayWest Plateforme', 'platform@paywest.internal', 'PLATFORM-ACCOUNT', '*', 'platform')
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `);

    // ON CONFLICT DO NOTHING ne renvoie AUCUNE ligne quand le compte existe
    // deja : sans ce repli, la creation du wallet echouerait silencieusement
    // des le deuxieme lancement de ce script.
    const platformId = platformInsert.rows.length > 0
      ? platformInsert.rows[0].id
      : (await pool.query(
          `SELECT id FROM users WHERE email = 'platform@paywest.internal'`
        )).rows[0].id;

    await pool.query(
      `INSERT INTO wallets (user_id, balance, currency)
       VALUES ($1, 0, 'XOF')
       ON CONFLICT (user_id) DO NOTHING`,
      [platformId]
    );

    console.log(`✅ Compte plateforme prêt (user_id=${platformId})`);
```

- [ ] **Step 4: Créer le service de résolution**

Créer `src/services/platformAccount.js` :

```js
const pool = require('../config/db');

// L'id du compte plateforme ne change jamais : on le resout une fois et on le
// memorise, plutot que de payer une requete par transfert.
let cachedId = null;

const getPlatformUserId = async () => {
  if (cachedId !== null) return cachedId;

  const result = await pool.query(
    `SELECT id FROM users WHERE role = 'platform' ORDER BY id LIMIT 1`
  );

  if (result.rows.length === 0) {
    throw new Error(
      'Compte plateforme introuvable : lancer `node src/config/initDb.js`'
    );
  }

  cachedId = result.rows[0].id;
  return cachedId;
};

// Reservee aux tests.
const resetPlatformCache = () => {
  cachedId = null;
};

module.exports = { getPlatformUserId, resetPlatformCache };
```

- [ ] **Step 5: Amorcer la résolution au démarrage**

Dans `src/index.js`, remplacer le bloc de démarrage (lignes 95-99) par :

```js
// Démarrage du serveur
if (require.main === module) {
  const { getPlatformUserId } = require('./services/platformAccount');

  // Resolution au demarrage plutot qu'au premier transfert : un compte
  // plateforme absent doit se voir tout de suite dans les logs, pas au moment
  // ou un client envoie de l'argent.
  //
  // Volontairement A L'INTERIEUR de ce bloc : au niveau du module, chaque
  // fichier de test qui importe `app` sans le demarrer ouvrirait une
  // connexion base inutile.
  getPlatformUserId()
    .then((id) => console.log(`Compte plateforme résolu (user_id=${id})`))
    .catch((error) => console.error('❌ Compte plateforme:', error.message));

  app.listen(PORT, () => {
    console.log(`Serveur PayWest démarré sur le port ${PORT}`);
  });
}
```

- [ ] **Step 6: Appliquer le schéma sur la base de test**

```powershell
$env:NODE_ENV='test'; node src/config/initDb.js
```

Expected: `✅ Tables créées avec succès !` puis `✅ Compte plateforme prêt (user_id=…)`.

Relancer la commande une seconde fois : elle doit réussir à l'identique et afficher le **même** `user_id`. C'est la vérification que le repli sur `SELECT` fonctionne et que le script reste idempotent.

- [ ] **Step 7: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/tests/platformAccount.test.js`
Expected: PASS

- [ ] **Step 8: Appliquer le schéma sur la production**

```powershell
node src/config/initDb.js
```

Sans `NODE_ENV=test`, `src/config/db.js` utilise `DATABASE_URL`, donc la base de production. Vérifier ensuite, avant de continuer :

```powershell
node -e "const p=require('./src/config/db'); p.query(`"SELECT (SELECT COUNT(*) FROM users WHERE role='platform') AS comptes, (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='transactions' AND column_name='fee') AS colonne_fee`").then(r=>{console.log(r.rows[0]); return p.end();})"
```

Expected: `{ comptes: '1', colonne_fee: '1' }`

- [ ] **Step 9: Commit**

```bash
git status --short
git add src/config/initDb.js src/services/platformAccount.js src/index.js src/tests/platformAccount.test.js
git commit -m "feat(fees): colonne fee et compte plateforme dedie"
```

---

### Task 3 : Routes de consultation `/api/fees`

**Files:**
- Create: `src/controllers/feeController.js`
- Create: `src/routes/feeRoutes.js`
- Modify: `src/index.js` (import + montage de la route)
- Test: `src/tests/feesApi.test.js`

**Interfaces:**
- Consumes: `computeFee`, `FEE_TIERS` (tâche 1).
- Produces: `GET /api/fees` et `GET /api/fees/quote?amount=N`. Aucune tâche ultérieure n'en dépend.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/tests/feesApi.test.js` :

```js
const request = require('supertest');
const app = require('../../src/index');
const pool = require('../../src/config/db');

let token;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      // Aucune valeur de repli en dur : le depot est public.
      password: process.env.TEST_PASSWORD
    });
  token = res.body.token;
});

// Pas de pool.end() : voir la note dans platformAccount.test.js.

describe('GET /api/fees', () => {
  it('retourne la grille complete', async () => {
    const res = await request(app)
      .get('/api/fees')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.currency).toBe('XOF');
    expect(res.body.tiers).toHaveLength(6);
    expect(res.body.tiers[0]).toEqual({ min: 0, max: 5000, fee: 100 });
    // Infinity n'est pas serialisable en JSON : la derniere borne est exposee
    // en null, ce que le client doit lire comme "sans limite haute".
    expect(res.body.tiers[5]).toEqual({ min: 500001, max: null, fee: 5000 });
  });

  it('rejette sans token', async () => {
    const res = await request(app).get('/api/fees');
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/fees/quote', () => {
  it('chiffre un transfert', async () => {
    const res = await request(app)
      .get('/api/fees/quote?amount=50000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      amount: 50000,
      fee: 500,
      total_debit: 50500,
      receiver_gets: 50000
    });
  });

  it.each([['0'], ['-100'], ['abc'], ['']])(
    'rejette le montant %p',
    async (amount) => {
      const res = await request(app)
        .get(`/api/fees/quote?amount=${amount}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(400);
    }
  );

  it('rejette un montant absent', async () => {
    const res = await request(app)
      .get('/api/fees/quote')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(400);
  });

  it('rejette sans token', async () => {
    const res = await request(app).get('/api/fees/quote?amount=1000');
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/tests/feesApi.test.js`
Expected: FAIL — les deux routes renvoient 404.

- [ ] **Step 3: Écrire le contrôleur**

Créer `src/controllers/feeController.js` :

```js
const { FEE_TIERS, computeFee } = require('../services/feeService');

// Grille tarifaire, pour affichage dans l'app.
const getFeeGrid = (req, res) => {
  res.json({
    currency: 'XOF',
    tiers: FEE_TIERS.map((tier) => ({
      min: tier.min,
      // Infinity ne survit pas a JSON.stringify (il deviendrait null
      // implicitement) : on l'expose explicitement en null.
      max: Number.isFinite(tier.max) ? tier.max : null,
      fee: tier.fee
    }))
  });
};

// Devis avant confirmation : l'app affiche le cout reel a l'utilisateur.
const getQuote = (req, res) => {
  const amount = Number(req.query.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const fee = computeFee(amount);

  res.json({
    amount,
    fee,
    total_debit: amount + fee,
    receiver_gets: amount
  });
};

module.exports = { getFeeGrid, getQuote };
```

Note : `Number('')` vaut `0` et `Number(undefined)` vaut `NaN` — les cas « vide » et « absent » du test sont donc couverts par la même garde.

- [ ] **Step 4: Écrire la route**

Créer `src/routes/feeRoutes.js` :

```js
const express = require('express');
const router = express.Router();
const { getFeeGrid, getQuote } = require('../controllers/feeController');
const { verifyToken } = require('../middleware/authMiddleware');

/**
 * @swagger
 * /api/fees:
 *   get:
 *     summary: Consulter la grille tarifaire des transferts
 *     tags: [Frais]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Grille des paliers de frais
 *       401:
 *         description: Non authentifié
 */
router.get('/', verifyToken, getFeeGrid);

/**
 * @swagger
 * /api/fees/quote:
 *   get:
 *     summary: Chiffrer les frais d'un transfert avant confirmation
 *     tags: [Frais]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: amount
 *         required: true
 *         schema:
 *           type: integer
 *           example: 50000
 *     responses:
 *       200:
 *         description: Montant, frais, débit total et somme reçue
 *       400:
 *         description: Montant invalide
 *       401:
 *         description: Non authentifié
 */
router.get('/quote', verifyToken, getQuote);

module.exports = router;
```

- [ ] **Step 5: Monter la route dans `src/index.js`**

Ajouter l'import auprès des autres (après `const otpRoutes = require('./routes/otpRoutes');`) :

```js
const feeRoutes = require('./routes/feeRoutes');
```

Puis le montage, auprès des autres routes de consultation (après `app.use('/api/currency', currencyRoutes);`) :

```js
app.use('/api/fees', feeRoutes);
```

Pas de `transactionLimiter` : ce sont deux lectures sans effet de bord, couvertes par le `generalLimiter` déjà monté sur `/api`.

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/tests/feesApi.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git status --short
git add src/controllers/feeController.js src/routes/feeRoutes.js src/index.js src/tests/feesApi.test.js
git commit -m "feat(fees): routes de consultation de la grille et de devis"
```

---

### Task 4 : Prélèvement dans `sendMoney`

**Files:**
- Modify: `src/controllers/transactionController.js:8-121` (`sendMoney`)
- Modify: `src/tests/otp.test.js:45-55` (helper `reverseTransfer`)
- Test: `src/tests/transferFees.test.js`

**Interfaces:**
- Consumes: `computeFee` (tâche 1), `getPlatformUserId` (tâche 2).
- Produces: réponse de `POST /api/transactions/send` enrichie de `fee` et `total_debit`; `transaction.fee` sur l'objet retourné.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/tests/transferFees.test.js`. Le montant de 10 000 XOF est choisi sous le seuil OTP de 100 000, pour que ce fichier teste le prélèvement et rien d'autre.

```js
const request = require('supertest');
const app = require('../../src/index');
const pool = require('../../src/config/db');
const { phoneVariants } = require('../../src/utils/phoneHelper');

let token;
let senderId;
let receiverId;
let platformId;

const RECEIVER_PHONE = '+221770000001';
const AMOUNT = 10000;
const EXPECTED_FEE = 250;

const balanceOf = async (userId) => {
  const res = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
  return parseFloat(res.rows[0].balance);
};

const userIdByPhone = async (phone) => {
  const variants = phoneVariants(phone);
  const placeholders = variants.map((_, i) => `$${i + 1}`).join(', ');
  const res = await pool.query(`SELECT id FROM users WHERE phone IN (${placeholders})`, variants);
  return res.rows[0].id;
};

beforeAll(async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      // Aucune valeur de repli en dur : le depot est public.
      password: process.env.TEST_PASSWORD
    });
  token = login.body.token;

  const sender = await pool.query(`SELECT id FROM users WHERE email = 'bienvenu@paywest.com'`);
  senderId = sender.rows[0].id;
  receiverId = await userIdByPhone(RECEIVER_PHONE);

  const platform = await pool.query(`SELECT id FROM users WHERE role = 'platform'`);
  platformId = platform.rows[0].id;
});

// Pas de pool.end() : voir la note dans platformAccount.test.js.

describe('Prelevement des frais sur transfert', () => {
  it('debite l expediteur du montant + frais, credite le destinataire du montant seul et la plateforme des frais', async () => {
    const before = {
      sender: await balanceOf(senderId),
      receiver: await balanceOf(receiverId),
      platform: await balanceOf(platformId)
    };

    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: AMOUNT });

    expect(res.statusCode).toBe(200);
    expect(res.body.fee).toBe(EXPECTED_FEE);
    expect(res.body.total_debit).toBe(AMOUNT + EXPECTED_FEE);
    expect(parseFloat(res.body.transaction.fee)).toBe(EXPECTED_FEE);

    const after = {
      sender: await balanceOf(senderId),
      receiver: await balanceOf(receiverId),
      platform: await balanceOf(platformId)
    };

    expect(after.sender).toBe(before.sender - AMOUNT - EXPECTED_FEE);
    expect(after.receiver).toBe(before.receiver + AMOUNT);
    expect(after.platform).toBe(before.platform + EXPECTED_FEE);

    // L'invariant qui attrape toute erreur de signe ou de montant : rien ne
    // sort du systeme, les frais sont deplaces et non detruits.
    expect(after.sender + after.receiver + after.platform)
      .toBe(before.sender + before.receiver + before.platform);

    // Remise en etat de paywest_test.
    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [AMOUNT + EXPECTED_FEE, senderId]);
    await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [AMOUNT, receiverId]);
    await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [EXPECTED_FEE, platformId]);
    await pool.query('DELETE FROM transactions WHERE id = $1', [res.body.transaction.id]);
  });
});

describe('Solde insuffisant a cause des seuls frais', () => {
  let tempUserId;
  let tempToken;
  const suffix = Date.now().toString().slice(-7);
  const tempPhone = `+22178${suffix}`;
  const tempEmail = `frais.${suffix}@test.paywest`;

  beforeAll(async () => {
    await request(app).post('/api/auth/register').send({
      full_name: 'Test Frais',
      email: tempEmail,
      phone: tempPhone,
      password: 'Test@12345'
    });

    const user = await pool.query('SELECT id FROM users WHERE email = $1', [tempEmail]);
    tempUserId = user.rows[0].id;

    // Solde suffisant pour le montant, insuffisant pour montant + frais.
    await pool.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [10200, tempUserId]);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: tempEmail, password: 'Test@12345' });
    tempToken = login.body.token;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [tempUserId]);
    await pool.query('DELETE FROM wallets WHERE user_id = $1', [tempUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [tempUserId]);
  });

  it('refuse le transfert et detaille le manque', async () => {
    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: AMOUNT });

    expect(res.statusCode).toBe(400);
    expect(res.body.amount).toBe(AMOUNT);
    expect(res.body.fee).toBe(EXPECTED_FEE);
    expect(res.body.total_required).toBe(AMOUNT + EXPECTED_FEE);
    expect(res.body.balance).toBe(10200);

    // Aucun mouvement : le ROLLBACK a bien tout annule.
    expect(await balanceOf(tempUserId)).toBe(10200);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/tests/transferFees.test.js`
Expected: FAIL — `res.body.fee` est `undefined`, aucun frais n'est prélevé.

- [ ] **Step 3: Intégrer le prélèvement dans `sendMoney`**

Dans `src/controllers/transactionController.js`, ajouter les deux imports en tête de fichier :

```js
const { computeFee } = require('../services/feeService');
const { getPlatformUserId } = require('../services/platformAccount');
```

Puis, dans `sendMoney`, après la validation du montant et **avant** `pool.connect()` :

```js
  const fee = computeFee(amount);
  const total = amount + fee;
  const platformUserId = await getPlatformUserId();
```

Remplacer le bloc de vérification du solde (lignes 45-49 actuelles) par :

```js
    if (parseFloat(senderWallet.rows[0].balance) < total) {
      await client.query('ROLLBACK');
      logger.warn('Solde insuffisant', { userId: req.user.id, amount, fee, total });
      return res.status(400).json({
        message: `Solde insuffisant : ${total.toLocaleString('fr-FR')} XOF requis`,
        amount,
        fee,
        total_required: total,
        balance: parseFloat(senderWallet.rows[0].balance)
      });
    }
```

Remplacer les deux `UPDATE wallets` et l'`INSERT` (lignes 51-67 actuelles) par :

```js
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [total, req.user.id]
    );

    await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, receiver.id]
    );

    // Credit plateforme en DERNIER : cette ligne de wallet est touchee par
    // tous les transferts, son verrou serialise donc les transactions
    // concurrentes jusqu'au COMMIT. La placer ici reduit la duree de
    // detention au minimum.
    if (fee > 0) {
      await client.query(
        `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
         WHERE user_id = $2`,
        [fee, platformUserId]
      );
    }

    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status, fee)
       VALUES ($1, $2, $3, 'transfer', 'completed', $4) RETURNING *`,
      [req.user.id, receiver.id, amount, fee]
    );
```

Enrichir le log de succès et la réponse :

```js
    logger.info('Transfert effectué', {
      senderId: req.user.id,
      receiverId: receiver.id,
      amount,
      fee,
      transactionId: transaction.rows[0].id
    });
```

```js
    res.json({
      message: 'Transfert effectué avec succès',
      transaction: transaction.rows[0],
      fee,
      total_debit: total
    });
```

Le montant notifié par email et SMS reste `amount` : c'est bien la somme reçue par le destinataire, et l'expéditeur voit le détail dans la réponse de l'API.

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/tests/transferFees.test.js`
Expected: PASS

- [ ] **Step 5: Corriger le helper `reverseTransfer` d'`otp.test.js`**

Ce helper annule un transfert de test. Il recrédite l'expéditeur du montant seul : avec des frais, l'expéditeur reste débité de `fee` à chaque transfert réussi et la plateforme conserve la somme. La base `paywest_test` dériverait d'environ 7 500 XOF par run. L'invariant Σ wallets reste vrai, ce qui rend la dérive silencieuse.

Dans `src/tests/otp.test.js`, remplacer le corps de `reverseTransfer` (lignes 45-55) par :

```js
const reverseTransfer = async (transaction, receiverPhone, amount) => {
  const variants = phoneVariants(receiverPhone);
  const placeholders = variants.map((_, i) => `$${i + 1}`).join(', ');
  const receiver = await pool.query(
    `SELECT id FROM users WHERE phone IN (${placeholders})`,
    variants
  );

  // L'expediteur a ete debite de amount + fee, la plateforme creditee de fee :
  // annuler le montant seul ferait deriver les soldes d'un run a l'autre.
  const fee = parseFloat(transaction.fee) || 0;

  await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [amount + fee, transaction.sender_id]);
  await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, receiver.rows[0].id]);

  if (fee > 0) {
    await pool.query(
      `UPDATE wallets SET balance = balance - $1
       WHERE user_id = (SELECT id FROM users WHERE role = 'platform')`,
      [fee]
    );
  }

  await pool.query('DELETE FROM transactions WHERE id = $1', [transaction.id]);
};
```

- [ ] **Step 6: Vérifier la suite complète et l'absence de dérive**

Relever le solde de l'expéditeur, lancer la suite entière deux fois, puis le relever à nouveau :

```powershell
$env:NODE_ENV='test'
node -e "const p=require('./src/config/db'); p.query(`"SELECT balance FROM wallets WHERE user_id=(SELECT id FROM users WHERE email='bienvenu@paywest.com')`").then(r=>{console.log('avant', r.rows[0].balance); return p.end();})"
npm test
npm test
node -e "const p=require('./src/config/db'); p.query(`"SELECT balance FROM wallets WHERE user_id=(SELECT id FROM users WHERE email='bienvenu@paywest.com')`").then(r=>{console.log('apres', r.rows[0].balance); return p.end();})"
```

Expected: suite verte deux fois, et surtout **`avant` égal à `apres`**. Un écart signale que `reverseTransfer` ne compense pas tout — ne pas continuer sans l'avoir compris.

- [ ] **Step 7: Commit**

```bash
git status --short
git add src/controllers/transactionController.js src/tests/transferFees.test.js src/tests/otp.test.js
git commit -m "feat(fees): prelever les frais sur les transferts P2P"
```

---

### Task 5 : Non-régression des plafonds et de l'OTP

**Files:**
- Test: `src/tests/feesRegression.test.js`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien — cette tâche verrouille par du code les deux décisions de cadrage qui n'ont pas d'autre trace exécutable.

- [ ] **Step 1: Écrire le test**

Ces deux tests prouvent que les frais restent hors des plafonds BCÉAO et hors du seuil OTP. Ils s'appuient sur l'ordre réel des middlewares de `transactionRoutes.js:40` : `checkTransactionLimits` s'exécute **avant** `requireOtp`.

Créer `src/tests/feesRegression.test.js` :

```js
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

    // 403 = defi OTP, donc checkTransactionLimits a laisse passer.
    // Si les frais comptaient dans le plafond, 152 500 > 150 000 aurait
    // produit un 400 avant meme d'atteindre requireOtp.
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
```

- [ ] **Step 2: Lancer le test**

Run: `npm test -- src/tests/feesRegression.test.js`
Expected: PASS

Si le premier test renvoie `400` avec un message de plafond, c'est que les frais ont été inclus dans `checkTransactionLimits` — contraire à la décision de cadrage. Corriger `transactionLimits.js` pour qu'il lise `req.body.amount` seul, ne pas ajuster le test.

- [ ] **Step 3: Lancer la suite complète**

Run: `npm test`
Expected: tous les fichiers verts, y compris `otp.test.js` et `transaction.test.js`.

- [ ] **Step 4: Commit**

```bash
git status --short
git add src/tests/feesRegression.test.js
git commit -m "test(fees): verrouiller l exclusion des frais des plafonds et du seuil OTP"
```

---

### Task 6 : Documentation Swagger du transfert et déploiement

**Files:**
- Modify: `src/routes/transactionRoutes.js:10-39` (bloc Swagger de `/send`)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: livraison en production.

- [ ] **Step 1: Mettre à jour la documentation de `/api/transactions/send`**

Dans le bloc Swagger existant, remplacer la section `responses` par :

```
 *     responses:
 *       200:
 *         description: Transfert effectué avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Transfert effectué avec succès
 *                 fee:
 *                   type: integer
 *                   description: Frais prélevés en sus du montant, à la charge de l'expéditeur
 *                   example: 250
 *                 total_debit:
 *                   type: integer
 *                   description: Somme réellement débitée de l'expéditeur (montant + frais)
 *                   example: 10250
 *       400:
 *         description: Solde insuffisant (montant + frais), montant invalide ou limite dépassée
 *       403:
 *         description: Code OTP requis (montant supérieur à 100 000 XOF)
 *       404:
 *         description: Destinataire non trouvé
```

- [ ] **Step 2: Vérifier la suite complète une dernière fois**

Run: `npm test`
Expected: tous les tests verts.

- [ ] **Step 3: Commit**

```bash
git status --short
git add src/routes/transactionRoutes.js
git commit -m "docs(fees): documenter fee et total_debit sur le transfert"
```

- [ ] **Step 4: Pousser et vérifier le déploiement**

```bash
git status --short
git push origin main
```

Puis, conformément à la vérification systématique en vigueur sur ce projet :

1. `GET /v1/services/srv-d910o75aeets73eg878g/deploys?limit=1` — confirmer `status: "live"` et `trigger: "new_commit"`. Un `trigger` redevenu manuel signale le retour de la panne de l'app GitHub Render.
2. `GET /v1/logs?ownerId=tea-d6sij6kr85hc73et9d10&resource=srv-d910o75aeets73eg878g&level=error` — confirmer 0 erreur depuis le déploiement, et repérer la ligne `Compte plateforme résolu (user_id=…)` dans les logs de démarrage.
3. `GET https://paywest-backend-1.onrender.com/` — HTTP 200.
4. `GET https://paywest-backend-1.onrender.com/api/fees` avec un token valide — la grille doit répondre.

La clé API Render se lit via `[Environment]::GetEnvironmentVariable('RENDER_API_KEY','User')` et ne doit jamais transiter par la conversation.

- [ ] **Step 5: Mettre à jour `AUDIT.md`**

Ajouter au chapitre « Travaux de durcissement postérieurs à l'audit » une section sur le moteur de frais : périmètre (transferts P2P seuls), barème, compte plateforme et son verrouillage, décision d'exclure les frais des plafonds et du seuil OTP, et la correction de `reverseTransfer`.

Le fichier reste **local et non commité** — vérifier `git check-ignore -v AUDIT.md` avant de terminer.

---

## Notes d'exécution

**Ordre des tâches.** La tâche 2 doit être appliquée sur `paywest_test` avant la tâche 4, sinon les tests d'intégration échouent sur une colonne `fee` absente. La tâche 3 est indépendante des tâches 4-5 et peut être traitée dans n'importe quel ordre après la tâche 1.

**Ce qu'aucune tâche ne doit toucher.** `src/middleware/transactionLimits.js`, `src/middleware/requireOtp.js` et `src/middleware/idempotency.js` restent inchangés. Ces trois fichiers ont été audités à trois reprises ; toute modification apportée par ce chantier serait un signal que le cadrage a dérivé.

**Point préexistant, hors périmètre.** Deux transferts croisés simultanés (A→B et B→A) peuvent se bloquer mutuellement, les wallets étant verrouillés dans l'ordre expéditeur-puis-destinataire. Le crédit plateforme placé en dernier n'aggrave pas la situation. À traiter séparément.
