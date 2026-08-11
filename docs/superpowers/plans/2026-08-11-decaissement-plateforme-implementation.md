# Décaissement des revenus plateforme — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** permettre à un admin de sortir les revenus accumulés sur le wallet plateforme, par transfert interne vers un compte PayWest fixe, protégé par un OTP SMS systématique.

**Architecture :** un service `payoutDestination` résout le bénéficiaire depuis une variable d'environnement (jamais depuis la requête), un contrôleur dédié `payoutController` exécute le mouvement dans une seule transaction SQL, et deux routes admin l'exposent derrière la chaîne `adminOnly → auditLog → idempotency → requireOtp`. Le middleware OTP existant passe d'un seuil unique à un seuil par usage.

**Tech Stack :** Node.js, Express, PostgreSQL (`pg`), Jest + Supertest, bcryptjs, Winston.

Spec de référence : `docs/superpowers/specs/2026-08-11-decaissement-plateforme-design.md`.

## Global Constraints

- **Aucune migration de schéma.** `transactions.type` est un `VARCHAR(20)` sans contrainte `CHECK`, `transactions.fee` est `NOT NULL DEFAULT 0`. Ne pas modifier `initDb.js` en dehors de ce que le plan demande explicitement (il ne le demande nulle part).
- **Jamais de `pool.end()` dans un fichier de test.** `src/config/db.js` exporte un pool singleton partagé entre fichiers dans le même worker Jest ; le premier à fermer fait échouer tous les suivants.
- **Zéro dérive de solde sur `paywest_test`.** Tout test qui déplace de l'argent l'annule exactement (recrédit, débit, `DELETE` de la ligne de transaction par son `id`).
- **Aucun mot de passe en dur.** Les tests se connectent avec `process.env.TEST_PASSWORD` (compte `bienvenu@paywest.com`, rôle admin) et `process.env.TEST_AGENT_PASSWORD` (compte `agent@paywest.com`, rôle agent). Le dépôt GitHub est **public**.
- **`AUDIT.md` ne doit jamais être commité.** Vérifier `git status` avant chaque `git commit` ; n'ajouter que les fichiers listés dans la tâche.
- **Commandes de test :** `npm test` lance la suite complète (`NODE_ENV=test`, base `paywest_test`, `--forceExit`). Un fichier seul : `npm test -- src/tests/<fichier>.test.js`.
- Messages utilisateur en français avec accents ; commentaires de code sans accents, comme le reste du projet.

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `src/services/payoutDestination.js` (créer) | Résoudre et mémoriser l'id du compte bénéficiaire depuis `PAYOUT_DESTINATION_EMAIL` | 1 |
| `src/tests/payoutDestination.test.js` (créer) | Tests du service | 1 |
| `.env.example` (modifier) | Documenter la nouvelle variable | 1 |
| `src/tests/setup.js` (modifier) | Exiger la variable avant de lancer les tests | 1 |
| `src/index.js` (modifier, ~ligne 99-116) | Résolution au démarrage, sur le modèle de `platformAccount` | 1 |
| `src/middleware/requireOtp.js` (modifier) | Seuil par usage, binding et champs requis pour `admin.payout` | 2 |
| `src/controllers/otpController.js` (modifier, ligne 22) | Consommer `REQUIRED_BODY_FIELDS` au lieu du ternaire | 2 |
| `src/tests/otpPurposes.test.js` (créer) | Non-régression des seuils + renvoi de code pour `admin.payout` | 2 |
| `src/middleware/auditLog.js` (modifier) | Masquer les champs sensibles du body enregistré | 3 |
| `src/tests/auditLog.test.js` (créer) | Tests du masquage | 3 |
| `src/controllers/payoutController.js` (créer) | `getPlatformBalance` puis `createPayout` | 4, 5 |
| `src/routes/adminRoutes.js` (modifier) | Déclarer les deux routes + Swagger | 4, 5, 6 |
| `src/tests/payout.test.js` (créer) | Tests des deux routes | 4, 5 |

---

### Task 1: Service de résolution du bénéficiaire

**Files:**
- Create: `src/services/payoutDestination.js`
- Create: `src/tests/payoutDestination.test.js`
- Modify: `.env.example`
- Modify: `src/tests/setup.js:21`
- Modify: `src/index.js:99-116`

**Interfaces:**
- Consumes: `getPlatformUserId()` depuis `src/services/platformAccount.js` — `async () => Promise<number>`, lève une `Error` si aucun compte `role='platform'`.
- Produces: `src/services/payoutDestination.js` exporte `{ getPayoutDestinationId, resetPayoutDestinationCache }`.
  - `getPayoutDestinationId()` → `Promise<number>` (id du compte bénéficiaire), lève une `Error` explicite si la variable est absente, si l'email est inconnu, ou s'il désigne le compte plateforme.
  - `resetPayoutDestinationCache()` → `void`, réservé aux tests.

- [ ] **Step 1: Poser la variable d'environnement en local**

Ajouter dans `.env` (fichier local, jamais commité — il est couvert par `.gitignore` en `.env*`) :

```
PAYOUT_DESTINATION_EMAIL=bienvenu@paywest.com
```

Ce compte existe dans la base de production **et** dans `paywest_test` (c'est un des trois comptes cœur seedés). La valeur retenue pour la production sera confirmée par l'utilisateur au moment du déploiement (tâche 6).

Ajouter dans `.env.example`, après la ligne `ORANGE_WEBHOOK_SECRET=` :

```
# Compte PayWest qui recoit les decaissements du wallet plateforme.
# Resolu cote serveur uniquement : jamais lu dans le corps d'une requete.
PAYOUT_DESTINATION_EMAIL=
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `src/tests/payoutDestination.test.js` :

```js
const pool = require('../../src/config/db');
const {
  getPayoutDestinationId,
  resetPayoutDestinationCache
} = require('../../src/services/payoutDestination');

const ORIGINAL_EMAIL = process.env.PAYOUT_DESTINATION_EMAIL;

beforeEach(() => {
  resetPayoutDestinationCache();
  process.env.PAYOUT_DESTINATION_EMAIL = ORIGINAL_EMAIL;
});

afterAll(() => {
  process.env.PAYOUT_DESTINATION_EMAIL = ORIGINAL_EMAIL;
  resetPayoutDestinationCache();
});

describe('payoutDestination', () => {

  it('resout l id du compte configure', async () => {
    const expected = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [ORIGINAL_EMAIL]
    );

    const id = await getPayoutDestinationId();

    expect(id).toBe(expected.rows[0].id);
  });

  it('memorise la resolution et ne requete la base qu une fois', async () => {
    const spy = jest.spyOn(pool, 'query');

    await getPayoutDestinationId();
    const callsAfterFirst = spy.mock.calls.length;
    await getPayoutDestinationId();

    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    spy.mockRestore();
  });

  it('leve une erreur explicite si la variable est absente', async () => {
    delete process.env.PAYOUT_DESTINATION_EMAIL;

    await expect(getPayoutDestinationId()).rejects.toThrow(/PAYOUT_DESTINATION_EMAIL/);
  });

  it('leve une erreur si l email ne correspond a aucun compte', async () => {
    process.env.PAYOUT_DESTINATION_EMAIL = 'inconnu-au-bataillon@paywest.test';

    await expect(getPayoutDestinationId()).rejects.toThrow(/introuvable/i);
  });

  it('refuse un email qui designe le compte plateforme lui-meme', async () => {
    process.env.PAYOUT_DESTINATION_EMAIL = 'platform@paywest.internal';

    await expect(getPayoutDestinationId()).rejects.toThrow(/plateforme/i);
  });
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/tests/payoutDestination.test.js`
Expected: FAIL — `Cannot find module '../../src/services/payoutDestination'`

- [ ] **Step 4: Écrire le service**

Créer `src/services/payoutDestination.js` :

```js
const pool = require('../config/db');
const { getPlatformUserId } = require('./platformAccount');

// Meme raisonnement que platformAccount : l'id ne change pas d'un
// decaissement a l'autre, on le resout une fois et on le memorise.
let cachedId = null;

// Le beneficiaire est resolu cote serveur, jamais lu dans la requete : un
// compte admin compromis peut declencher un decaissement, mais pas le
// detourner. Le changer suppose un acces aux variables d'environnement.
const getPayoutDestinationId = async () => {
  if (cachedId !== null) return cachedId;

  const email = process.env.PAYOUT_DESTINATION_EMAIL;
  if (!email) {
    throw new Error(
      'PAYOUT_DESTINATION_EMAIL non définie : aucun compte bénéficiaire configuré pour le décaissement.'
    );
  }

  const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) {
    throw new Error(`Compte de décaissement introuvable pour l'email configuré (${email}).`);
  }

  const id = result.rows[0].id;

  // Un beneficiaire egal au compte plateforme ferait une ecriture qui ne
  // deplace rien tout en enregistrant une transaction : c'est une erreur de
  // configuration, pas une operation legitime.
  const platformId = await getPlatformUserId();
  if (id === platformId) {
    throw new Error(
      'PAYOUT_DESTINATION_EMAIL désigne le compte plateforme lui-même : configuration incohérente.'
    );
  }

  cachedId = id;
  return cachedId;
};

// Reservee aux tests.
const resetPayoutDestinationCache = () => {
  cachedId = null;
};

module.exports = { getPayoutDestinationId, resetPayoutDestinationCache };
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/tests/payoutDestination.test.js`
Expected: PASS, 5/5

- [ ] **Step 6: Exiger la variable dans l'environnement de test**

Dans `src/tests/setup.js:21`, remplacer :

```js
for (const variable of ['TEST_PASSWORD', 'TEST_AGENT_PASSWORD']) {
  if (!process.env[variable]) {
    throw new Error(
      `${variable} manquant : les tests se connectent avec cette variable, ` +
      'et aucun mot de passe n\'est code en dur. La definir dans .env.'
    );
  }
}
```

par :

```js
for (const variable of ['TEST_PASSWORD', 'TEST_AGENT_PASSWORD']) {
  if (!process.env[variable]) {
    throw new Error(
      `${variable} manquant : les tests se connectent avec cette variable, ` +
      'et aucun mot de passe n\'est code en dur. La definir dans .env.'
    );
  }
}

if (!process.env.PAYOUT_DESTINATION_EMAIL) {
  throw new Error(
    'PAYOUT_DESTINATION_EMAIL manquant : les tests de décaissement résolvent ' +
    'le compte bénéficiaire par cette variable. La définir dans .env.'
  );
}
```

- [ ] **Step 7: Résoudre le bénéficiaire au démarrage**

Dans `src/index.js`, à l'intérieur du bloc `if (require.main === module) {`, après le bloc `getPlatformUserId()` existant (lignes 100-111) et avant `app.listen` :

```js
  const { getPayoutDestinationId } = require('./services/payoutDestination');

  // Meme motif que ci-dessus : une variable oubliee ou un email errone doit
  // se voir dans les logs de demarrage, pas au moment ou un admin declenche
  // un decaissement.
  //
  // .catch qui logue et n'interrompt rien, exactement comme le compte
  // plateforme : une configuration de decaissement absente ne doit pas
  // empecher l'API de paiement de demarrer. Seule /api/admin/payout tombe.
  getPayoutDestinationId()
    .then((id) => console.log(`Compte de décaissement résolu (user_id=${id})`))
    .catch((error) => console.error('❌ Compte de décaissement:', error.message));
```

- [ ] **Step 8: Vérifier que la suite complète passe toujours**

Run: `npm test`
Expected: PASS, tous les fichiers. La suite comptait 87 tests avant ce chantier, elle doit en compter 92 (5 ajoutés).

- [ ] **Step 9: Commit**

```bash
git status
git add src/services/payoutDestination.js src/tests/payoutDestination.test.js src/tests/setup.js src/index.js .env.example
git commit -m "feat(payout): service de resolution du compte beneficiaire"
```

---

### Task 2: Seuil OTP par usage et champs requis par usage

**Files:**
- Modify: `src/middleware/requireOtp.js:7`, `:16-20`, `:78-83`, `:192-199`
- Modify: `src/controllers/otpController.js:22-26`
- Create: `src/tests/otpPurposes.test.js`

**Interfaces:**
- Consumes: rien de la tâche 1.
- Produces: `src/middleware/requireOtp.js` exporte désormais `{ requireOtp, computeBindingHash, generateAndSendOtp, isValidPurpose, OTP_THRESHOLDS, REQUIRED_BODY_FIELDS, RESEND_COOLDOWN_MS }`.
  - `OTP_THRESHOLDS` : `Record<string, number>` — montant **au-dessus** duquel un code est exigé (comparaison `amount <= seuil → pas d'OTP`).
  - `REQUIRED_BODY_FIELDS` : `Record<string, string[]>` — champs de body obligatoires pour `/api/otp/resend`, par usage.
  - `requireOtp(purpose)` lève désormais une `Error` synchrone si `purpose` est inconnu (au moment de la déclaration des routes, donc au démarrage).
  - L'export `OTP_THRESHOLD` (singulier) **disparaît** : vérifié, aucun fichier source ne l'importe.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/tests/otpPurposes.test.js` :

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
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test -- src/tests/otpPurposes.test.js`
Expected: FAIL — `OTP_THRESHOLDS` est `undefined`, et le renvoi `admin.payout` renvoie 400 « Motif (purpose) invalide » au lieu de 404.

- [ ] **Step 3: Remplacer le seuil unique par une table**

Dans `src/middleware/requireOtp.js`, remplacer la ligne 7 :

```js
const OTP_THRESHOLD = 100000;
```

par :

```js
// Montant AU-DESSUS duquel un code est exige, par usage. La comparaison
// etant `amount <= seuil -> pas d'OTP`, un seuil a 0 signifie « tout montant
// strictement positif exige un code », sans cas particulier dans le code.
const OTP_THRESHOLDS = {
  'transactions.send': 100000,
  'withdraw.wave': 100000,
  'withdraw.orange': 100000,
  'admin.payout': 0
};
```

- [ ] **Step 4: Ajouter le binding et les champs requis**

Dans le même fichier, ajouter l'entrée `admin.payout` à `BINDING_FIELDS` (ligne 19, après `withdraw.orange`) :

```js
  'withdraw.orange': (body) => `${body.amount}:${body.phone}`,
  // La destination d'un decaissement est fixee cote serveur : le montant
  // identifie seul l'operation.
  'admin.payout': (body) => `${body.amount}:payout`
```

Puis, juste après le bloc `BINDING_FIELDS` (avant `isValidPurpose`), ajouter :

```js
// Champs du body que /api/otp/resend doit exiger pour reconstituer le
// binding, par usage. Table plutot que ternaire : un ternaire sur le purpose
// devient faux en silence des qu'un usage est ajoute — c'etait le cas ici,
// `admin.payout` se serait mis a reclamer un `phone` qui n'entre meme pas
// dans son binding.
const REQUIRED_BODY_FIELDS = {
  'transactions.send': ['receiver_phone'],
  'withdraw.wave': ['phone'],
  'withdraw.orange': ['phone'],
  'admin.payout': []
};
```

- [ ] **Step 5: Utiliser le seuil de l'usage et refuser un usage inconnu**

Remplacer l'ouverture de `requireOtp` (lignes 78-83) :

```js
const requireOtp = (purpose) => async (req, res, next) => {
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= OTP_THRESHOLD) {
    return next();
  }
```

par :

```js
const requireOtp = (purpose) => {
  // Verification a la construction du middleware, donc au chargement des
  // routes : un usage mal orthographie fait echouer le demarrage au lieu de
  // laisser passer les requetes sans OTP (`amount <= undefined` est faux,
  // mais le binding, lui, planterait a la premiere requete).
  if (!isValidPurpose(purpose)) {
    throw new Error(`Usage OTP inconnu : ${purpose}`);
  }

  return async (req, res, next) => {
    const amount = Number(req.body.amount);

    // Un amount non numerique saute l'OTP et tombe sur la validation du
    // controleur, qui repond 400 : rien ne bouge. Contre-intuitif pour un
    // usage a seuil 0, mais volontaire — sans montant exploitable il n'y a
    // pas de binding a calculer.
    if (!Number.isFinite(amount) || amount <= OTP_THRESHOLDS[purpose]) {
      return next();
    }
```

Puis **réindenter le reste du corps de la fonction** (de `const userId = req.user.id;` jusqu'au `catch` final) d'un niveau supplémentaire, et fermer la fonction retournée avant l'accolade du factory :

```js
    } catch (error) {
      logger.error('Erreur vérification OTP', { error: error.message, userId, purpose });
      res.status(500).json({ message: 'Erreur serveur' });
    }
  };
};
```

- [ ] **Step 6: Mettre à jour les exports**

Remplacer le bloc `module.exports` (lignes 192-199) par :

```js
module.exports = {
  requireOtp,
  computeBindingHash,
  generateAndSendOtp,
  isValidPurpose,
  OTP_THRESHOLDS,
  REQUIRED_BODY_FIELDS,
  RESEND_COOLDOWN_MS
};
```

- [ ] **Step 7: Consommer la table dans le contrôleur de renvoi**

Dans `src/controllers/otpController.js`, ajouter `REQUIRED_BODY_FIELDS` à l'import (lignes 3-8) :

```js
const {
  computeBindingHash,
  generateAndSendOtp,
  isValidPurpose,
  REQUIRED_BODY_FIELDS,
  RESEND_COOLDOWN_MS
} = require('../middleware/requireOtp');
```

Puis remplacer les lignes 22-26 :

```js
  const targetField = purpose === 'transactions.send' ? 'receiver_phone' : 'phone';
  if (!req.body[targetField] || typeof req.body[targetField] !== 'string') {
    return res.status(400).json({ message: `Le champ ${targetField} est obligatoire` });
  }
```

par :

```js
  const missing = REQUIRED_BODY_FIELDS[purpose].filter(
    (field) => !req.body[field] || typeof req.body[field] !== 'string'
  );
  if (missing.length > 0) {
    return res.status(400).json({ message: `Le champ ${missing[0]} est obligatoire` });
  }
```

Le message reste identique à l'existant pour les trois usages clients : les tests en place continuent de passer.

- [ ] **Step 8: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test -- src/tests/otpPurposes.test.js`
Expected: PASS, 9/9

- [ ] **Step 9: Vérifier la non-régression de l'OTP existant**

Run: `npm test -- src/tests/otp.test.js`
Expected: PASS, aucun test cassé (le seuil de 100 000 sur `transactions.send` est inchangé).

Puis la suite complète :

Run: `npm test`
Expected: PASS, 101 tests (92 + 9).

- [ ] **Step 10: Commit**

```bash
git status
git add src/middleware/requireOtp.js src/controllers/otpController.js src/tests/otpPurposes.test.js
git commit -m "refactor(otp): seuil et champs requis par usage, ajout de admin.payout"
```

---

### Task 3: Masquer les champs sensibles dans le journal d'audit

**Files:**
- Modify: `src/middleware/auditLog.js`
- Create: `src/tests/auditLog.test.js`

**Interfaces:**
- Consumes: rien des tâches précédentes.
- Produces: `src/middleware/auditLog.js` continue d'exporter la fonction `auditLog(action)` comme export par défaut, avec une propriété attachée `auditLog.redactBody(body)` → `object`, réservée aux tests.

**Pourquoi cette tâche existe :** `auditLog` enregistre `req.body` intégralement dans `audit_logs.details`. `/api/admin/payout` est la **première** route à combiner `auditLog` et `requireOtp` : sans masquage, le code OTP d'un décaissement réussi serait stocké en clair et lisible via `GET /api/admin/audit`. Le code est déjà consommé à cet instant, donc l'exposition est faible — mais écrire un secret d'authentification en clair dans un journal consultable est une mauvaise base à poser.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `src/tests/auditLog.test.js` :

```js
const auditLog = require('../../src/middleware/auditLog');

describe('auditLog.redactBody', () => {

  it('masque le code OTP', () => {
    const result = auditLog.redactBody({ amount: 5000, otp_code: '123456' });

    expect(result.otp_code).toBe('[masqué]');
    expect(result.amount).toBe(5000);
  });

  it('masque les mots de passe', () => {
    const result = auditLog.redactBody({ email: 'a@b.c', password: 'secret', new_password: 'secret2' });

    expect(result.password).toBe('[masqué]');
    expect(result.new_password).toBe('[masqué]');
    expect(result.email).toBe('a@b.c');
  });

  it('ne modifie pas l objet d origine', () => {
    const body = { otp_code: '123456' };

    auditLog.redactBody(body);

    expect(body.otp_code).toBe('123456');
  });

  it('n ajoute pas de champ absent du body', () => {
    const result = auditLog.redactBody({ amount: 5000 });

    expect(Object.prototype.hasOwnProperty.call(result, 'otp_code')).toBe(false);
  });

  it('tolere un body absent ou non objet', () => {
    expect(auditLog.redactBody(undefined)).toBeUndefined();
    expect(auditLog.redactBody(null)).toBeNull();
    expect(auditLog.redactBody('texte')).toBe('texte');
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test -- src/tests/auditLog.test.js`
Expected: FAIL — `auditLog.redactBody is not a function`

- [ ] **Step 3: Implémenter le masquage**

Dans `src/middleware/auditLog.js`, ajouter après les `require` :

```js
// Champs d'authentification qui n'ont rien a faire en clair dans un journal
// consultable via GET /api/admin/audit. Le code OTP en fait partie :
// /api/admin/payout est la premiere route a combiner auditLog et requireOtp,
// et le body d'un decaissement reussi contient le code utilise.
const SENSITIVE_BODY_FIELDS = ['otp_code', 'password', 'new_password', 'old_password', 'pin'];

const redactBody = (body) => {
  if (!body || typeof body !== 'object') return body;

  const safe = { ...body };
  for (const field of SENSITIVE_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(safe, field)) {
      safe[field] = '[masqué]';
    }
  }
  return safe;
};
```

Remplacer `body: req.body,` (ligne 21) par :

```js
                body: redactBody(req.body),
```

Remplacer la dernière ligne du fichier :

```js
module.exports = auditLog;
```

par :

```js
module.exports = auditLog;
// Attachee plutot qu'exportee dans un objet : tous les fichiers de routes
// font `require('../middleware/auditLog')` et attendent la fonction elle-meme.
module.exports.redactBody = redactBody;
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `npm test -- src/tests/auditLog.test.js`
Expected: PASS, 5/5

- [ ] **Step 5: Vérifier que les routes auditées fonctionnent toujours**

Run: `npm test`
Expected: PASS, 106 tests (101 + 5).

- [ ] **Step 6: Commit**

```bash
git status
git add src/middleware/auditLog.js src/tests/auditLog.test.js
git commit -m "security(audit): masquer les champs sensibles du body journalise"
```

---

### Task 4: Route de consultation du solde plateforme

**Files:**
- Create: `src/controllers/payoutController.js`
- Modify: `src/routes/adminRoutes.js:3` (import) et fin de fichier (route)
- Create: `src/tests/payout.test.js`

**Interfaces:**
- Consumes: `getPlatformUserId()` de `src/services/platformAccount.js`.
- Produces: `src/controllers/payoutController.js` exporte `{ getPlatformBalance }` (la tâche 5 y ajoute `createPayout`).
  - `GET /api/admin/platform-balance` → 200 `{ platform_user_id: number, balance: number, currency: string }`.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/tests/payout.test.js` :

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

let adminToken;
let agentToken;
let platformUserId;

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
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test -- src/tests/payout.test.js`
Expected: FAIL — 404 au lieu de 200, la route n'existe pas.

- [ ] **Step 3: Créer le contrôleur**

Créer `src/controllers/payoutController.js` :

```js
const pool = require('../config/db');
const logger = require('../config/logger');
const { getPlatformUserId } = require('../services/platformAccount');

const getPlatformBalance = async (req, res) => {
  try {
    const platformUserId = await getPlatformUserId();

    const result = await pool.query(
      'SELECT balance, currency FROM wallets WHERE user_id = $1',
      [platformUserId]
    );

    if (result.rows.length === 0) {
      logger.error('Wallet plateforme introuvable', { platformUserId });
      return res.status(500).json({ message: 'Compte plateforme non configuré' });
    }

    res.json({
      platform_user_id: platformUserId,
      balance: parseFloat(result.rows[0].balance),
      currency: result.rows[0].currency
    });

  } catch (error) {
    logger.error('Erreur consultation solde plateforme', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { getPlatformBalance };
```

- [ ] **Step 4: Déclarer la route**

Dans `src/routes/adminRoutes.js`, ajouter après la ligne 5 (`const auditLog = ...`) :

```js
const { getPlatformBalance } = require('../controllers/payoutController');
```

Puis ajouter, avant `module.exports = router;` :

```js
router.get(
  '/platform-balance',
  adminOnly,
  auditLog('admin_view_platform_balance'),
  getPlatformBalance
);
```

Le bloc Swagger est ajouté en tâche 6.

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test -- src/tests/payout.test.js`
Expected: PASS, 3/3

- [ ] **Step 6: Commit**

```bash
git status
git add src/controllers/payoutController.js src/routes/adminRoutes.js src/tests/payout.test.js
git commit -m "feat(payout): route de consultation du solde plateforme"
```

---

### Task 5: Route de décaissement

**Files:**
- Modify: `src/controllers/payoutController.js`
- Modify: `src/routes/adminRoutes.js`
- Modify: `src/tests/payout.test.js`

**Interfaces:**
- Consumes:
  - `getPayoutDestinationId()` de `src/services/payoutDestination.js` (tâche 1)
  - `requireOtp('admin.payout')` de `src/middleware/requireOtp.js` (tâche 2)
  - `idempotency(label)` de `src/middleware/idempotency.js` — signature existante, `label` libre
  - `redactBody` déjà câblé dans `auditLog` (tâche 3)
- Produces: `src/controllers/payoutController.js` exporte `{ getPlatformBalance, validatePayoutAmount, createPayout }`.
  - `validatePayoutAmount(req, res, next)` — middleware Express, répond 400 si `amount` n'est pas un entier strictement positif, sinon appelle `next()`.
  - `POST /api/admin/payout` `{ amount: number, otp_code?: string }` → 200 `{ message, transaction, platform_balance }`.

**Pourquoi la validation est un middleware et non un test en tête de contrôleur :** `requireOtp` s'exécute **avant** le contrôleur. Un montant à virgule (`1500.5`) est fini et strictement supérieur au seuil `0`, donc sans validation préalable il déclencherait un défi OTP — **un vrai SMS** — avant d'être rejeté. Placer la validation avant `requireOtp` refuse la saisie invalide au plus tôt. La validation n'existe qu'à un seul endroit : le contrôleur ne la répète pas.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à la fin de `src/tests/payout.test.js` (et compléter l'en-tête du fichier avec les constantes ci-dessous, juste après `let platformUserId;`) :

```js
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
```

Compléter le `beforeAll` existant avec :

```js
  const destination = await pool.query('SELECT id FROM users WHERE email = $1', [
    process.env.PAYOUT_DESTINATION_EMAIL
  ]);
  destinationUserId = destination.rows[0].id;
```

Ajouter à la fin du fichier :

```js
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

    expect(res.statusCode).toBe(200);
    expect(res.body.transaction.type).toBe('payout');
    expect(res.body.transaction.status).toBe('completed');
    expect(res.body.transaction.sender_id).toBe(platformUserId);
    expect(res.body.transaction.receiver_id).toBe(destinationUserId);

    expect(await balanceOf(platformUserId)).toBe(platformBefore - amount);
    expect(await balanceOf(destinationUserId)).toBe(destinationBefore + amount);

    await reversePayout(res.body.transaction);
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

    const audit = await pool.query(
      `SELECT details FROM audit_logs WHERE action = 'admin_payout'
       ORDER BY created_at DESC LIMIT 1`
    );
    const details = typeof audit.rows[0].details === 'string'
      ? JSON.parse(audit.rows[0].details)
      : audit.rows[0].details;

    expect(details.body.otp_code).toBe('[masqué]');
    expect(details.body.amount).toBe(amount);

    await reversePayout(res.body.transaction);
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

    expect(res.statusCode).toBe(401);
    expect(res.body.otp_invalid).toBe(true);
    expect(await balanceOf(platformUserId)).toBe(before);

    await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [amount, platformUserId]);
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

    expect(res.statusCode).toBe(400);
    expect(res.body.balance).toBe(platformBalance);
    expect(res.body.amount).toBe(amount);
    expect(await balanceOf(platformUserId)).toBe(platformBalance);
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
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test -- src/tests/payout.test.js`
Expected: FAIL — 404 sur `POST /api/admin/payout`.

- [ ] **Step 3: Implémenter le décaissement**

Dans `src/controllers/payoutController.js`, ajouter l'import :

```js
const { getPayoutDestinationId } = require('../services/payoutDestination');
```

Ajouter la fonction avant `module.exports` :

```js
// Place AVANT requireOtp dans la chaine : un montant a virgule ou negatif est
// fini et superieur au seuil 0, il declencherait donc un defi OTP — et un vrai
// SMS — avant d'etre rejete par le controleur. On refuse la saisie invalide au
// plus tot.
//
// Entier strictement positif : les wallets sont en DECIMAL(15,2), mais un
// decaissement est une operation de tresorerie saisie a la main, pas un calcul.
// Refuser les decimales evite les surprises d'arrondi.
const validatePayoutAmount = (req, res, next) => {
  const amount = Number(req.body.amount);

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({
      message: 'Montant invalide : un entier strictement positif est attendu'
    });
  }

  next();
};

const createPayout = async (req, res) => {
  // Deja valide par validatePayoutAmount, qui precede cette fonction dans la
  // chaine de la route : entier strictement positif garanti.
  const amount = Number(req.body.amount);

  let platformUserId;
  let destinationUserId;
  try {
    platformUserId = await getPlatformUserId();
    destinationUserId = await getPayoutDestinationId();
  } catch (error) {
    // Variable absente, email inconnu, ou beneficiaire egal au compte
    // plateforme : c'est une erreur de configuration serveur, jamais une
    // erreur de l'appelant.
    logger.error('Décaissement indisponible', { error: error.message });
    return res.status(500).json({
      message: 'Décaissement indisponible : compte de destination non configuré'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // FOR UPDATE comme partout ailleurs sur les mouvements d'argent : verrouille
    // la ligne jusqu'au COMMIT, donc deux decaissements concurrents ne peuvent
    // pas lire le meme solde et le depasser a eux deux.
    const platformWallet = await client.query(
      'SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [platformUserId]
    );

    if (platformWallet.rows.length === 0) {
      await client.query('ROLLBACK');
      logger.error('Wallet plateforme introuvable', { platformUserId });
      return res.status(500).json({ message: 'Compte plateforme non configuré' });
    }

    const balance = parseFloat(platformWallet.rows[0].balance);

    if (balance < amount) {
      await client.query('ROLLBACK');
      logger.warn('Décaissement refusé, solde plateforme insuffisant', { amount, balance });
      return res.status(400).json({
        message: `Solde plateforme insuffisant : ${balance.toLocaleString('fr-FR')} XOF disponibles`,
        balance,
        amount
      });
    }

    await client.query(
      'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
      [amount, platformUserId]
    );

    await client.query(
      'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
      [amount, destinationUserId]
    );

    // fee omis volontairement : la colonne est NOT NULL DEFAULT 0, et un
    // decaissement n'est pas un transfert P2P — aucun frais ne s'y applique.
    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'payout', 'completed') RETURNING *`,
      [platformUserId, destinationUserId, amount]
    );

    await client.query('COMMIT');

    logger.info('Décaissement plateforme effectué', {
      adminId: req.user.id,
      amount,
      platformUserId,
      destinationUserId,
      platformBalanceAfter: balance - amount
    });

    res.json({
      message: 'Décaissement effectué',
      transaction: transaction.rows[0],
      platform_balance: balance - amount
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Erreur décaissement plateforme', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
  }
};
```

Remplacer la dernière ligne par :

```js
module.exports = { getPlatformBalance, validatePayoutAmount, createPayout };
```

- [ ] **Step 4: Déclarer la route**

Dans `src/routes/adminRoutes.js`, compléter l'import du contrôleur :

```js
const { getPlatformBalance, validatePayoutAmount, createPayout } = require('../controllers/payoutController');
```

Ajouter les imports des deux middlewares, après la ligne `const auditLog = ...` :

```js
const { idempotency } = require('../middleware/idempotency');
const { requireOtp } = require('../middleware/requireOtp');
```

Puis ajouter la route, après `router.get('/platform-balance', ...)` :

```js
// Ordre repris des routes monetaires existantes : l'audit enregistre
// l'intention en premier, l'idempotence protege du double envoi, et l'OTP est
// la derniere porte avant le controleur. checkTransactionLimits n'est
// volontairement PAS applique : les plafonds BCEAO encadrent les transferts
// clients, un mouvement interne de tresorerie n'entre pas dans leurs sommes.
router.post(
  '/payout',
  adminOnly,
  auditLog('admin_payout'),
  idempotency('admin.payout'),
  validatePayoutAmount,
  requireOtp('admin.payout'),
  createPayout
);
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `npm test -- src/tests/payout.test.js`
Expected: PASS, 10/10

- [ ] **Step 6: Vérifier qu'aucun solde n'a dérivé**

Relever la somme des wallets, lancer la suite, la relever à nouveau.

⚠️ **`NODE_ENV=test` est indispensable** : sans cette variable, `src/config/db.js` se connecte à `DATABASE_URL`, c'est-à-dire à la **production**. (`npm test` n'a pas le problème : Jest positionne `NODE_ENV=test` de lui-même.)

En PowerShell (shell du poste) :

```powershell
$env:NODE_ENV='test'; node -e "const p=require('./src/config/db');p.query('SELECT SUM(balance) FROM wallets').then(r=>{console.log(r.rows[0].sum);process.exit(0)})"
npm test
$env:NODE_ENV='test'; node -e "const p=require('./src/config/db');p.query('SELECT SUM(balance) FROM wallets').then(r=>{console.log(r.rows[0].sum);process.exit(0)})"
```

Expected: les deux sommes sont **strictement identiques**, et `npm test` passe à 113 tests (106 + 7).

- [ ] **Step 7: Commit**

```bash
git status
git add src/controllers/payoutController.js src/routes/adminRoutes.js src/tests/payout.test.js
git commit -m "feat(payout): decaissement du wallet plateforme vers le compte beneficiaire"
```

---

### Task 6: Documentation Swagger et vérification finale

**Files:**
- Modify: `src/routes/adminRoutes.js` (blocs Swagger uniquement)

**Interfaces:**
- Consumes: les deux routes des tâches 4 et 5.
- Produces: rien de consommé par une tâche ultérieure.

- [ ] **Step 1: Documenter la route de solde**

Dans `src/routes/adminRoutes.js`, insérer au-dessus de `router.get('/platform-balance', ...)` :

```js
/**
 * @swagger
 * /api/admin/platform-balance:
 *   get:
 *     summary: Solde du wallet plateforme (revenus de frais accumulés)
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Solde courant du compte plateforme
 *       403:
 *         description: Accès refusé — rôle admin requis
 */
```

- [ ] **Step 2: Documenter la route de décaissement**

Insérer au-dessus de `router.post('/payout', ...)` :

```js
/**
 * @swagger
 * /api/admin/payout:
 *   post:
 *     summary: Décaisser les revenus du wallet plateforme
 *     description: >
 *       Transfert interne du wallet plateforme vers un compte PayWest fixe,
 *       résolu côté serveur par la variable d'environnement
 *       PAYOUT_DESTINATION_EMAIL — la destination n'est jamais lue dans la
 *       requête. Un code OTP envoyé par SMS est exigé quel que soit le montant.
 *     tags: [Administration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         schema:
 *           type: string
 *         description: Optionnel — protège d'un double envoi
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: integer
 *                 example: 50000
 *               otp_code:
 *                 type: string
 *                 example: "123456"
 *                 description: Absent au premier appel — déclenche l'envoi du code
 *     responses:
 *       200:
 *         description: Décaissement effectué
 *       400:
 *         description: Montant invalide ou solde plateforme insuffisant
 *       401:
 *         description: Code OTP invalide ou expiré
 *       403:
 *         description: Rôle admin requis, ou code OTP exigé
 *       409:
 *         description: Requête identique déjà en cours de traitement
 *       500:
 *         description: Compte de destination non configuré
 *       502:
 *         description: Échec de l'envoi du SMS
 */
```

- [ ] **Step 3: Vérifier que Swagger indexe bien les deux routes**

Le projet n'expose pas de `/api-docs.json` (seulement l'UI sur `/api-docs`) : la vérification se fait hors serveur, en construisant la spec.

```powershell
node -e "const s=require('./src/config/swagger');console.log(Object.keys(s.paths).filter(p=>p.includes('payout')||p.includes('platform-balance')))"
```

Expected: `[ '/api/admin/platform-balance', '/api/admin/payout' ]`

Un bloc Swagger mal indenté ou au YAML invalide n'apparaît simplement pas dans `paths` — d'où cette vérification plutôt qu'un simple coup d'œil.

- [ ] **Step 4: Lancer la suite complète une dernière fois**

Run: `npm test`
Expected: PASS, 113 tests, 0 échec.

- [ ] **Step 5: Commit**

```bash
git status
git add src/routes/adminRoutes.js
git commit -m "docs(payout): documenter les routes de solde et de decaissement"
```

- [ ] **Step 6: Mise en production — à faire avec l'utilisateur, pas en autonomie**

Cette étape n'est pas exécutable par un agent seul : elle demande une décision et un accord explicite.

1. **Demander à l'utilisateur** quel compte doit recevoir les décaissements en production (valeur de `PAYOUT_DESTINATION_EMAIL`). La valeur locale `bienvenu@paywest.com` est un choix par défaut, pas une décision prise.
2. Poser la variable sur Render : `PUT /v1/services/srv-d910o75aeets73eg878g/env-vars/PAYOUT_DESTINATION_EMAIL`, puis **relire et comparer** — un 200 ne prouve rien.
3. Pousser la branche. `POST /v1/services/{id}/deploys` si l'auto-deploy ne part pas ; **jamais un restart**, il ne réapplique pas la configuration d'environnement.
4. Attendre `status: "live"`, vérifier les logs de build et de démarrage (dont la ligne `Compte de décaissement résolu`), et `GET /` à 200.
5. Proposer à l'utilisateur une preuve de bout en bout sur un petit montant, puis annulation exacte — comme pour le moteur de frais. **Ne la lancer qu'avec son accord explicite.**

---

## Self-Review

**Couverture de la spec :**

| Exigence de la spec | Tâche |
|---|---|
| Service `payoutDestination` (variable, email inconnu, égal plateforme, cache, reset) | 1 |
| Vérification au démarrage sans crash | 1, step 7 |
| `PAYOUT_DESTINATION_EMAIL` dans `.env`, `.env.example`, `setup.js`, Render | 1, 6 |
| `OTP_THRESHOLDS` par usage, seuil 0 pour `admin.payout` | 2 |
| Binding `${amount}:payout` | 2 |
| `REQUIRED_BODY_FIELDS`, suppression du ternaire d'`otpController` | 2 |
| Garde `!Number.isFinite` conservé et documenté | 2, step 5 + test « montants invalides » en 5 |
| Contrôleur dédié, transaction SQL unique, `type='payout'` | 5 |
| `GET /api/admin/platform-balance` | 4 |
| Chaîne `adminOnly → auditLog → idempotency → requireOtp` | 5, step 4 |
| Garde-fous : entier > 0, ≤ solde, bénéficiaire ≠ plateforme | 5, step 3 |
| Table des réponses d'erreur | 4, 5 (tests 403/400/401/500) |
| Traçabilité : audit, ligne `transactions`, `logger.info` | 5 |
| Swagger | 6 |
| Pas de migration | Global Constraints |

**Ajout hors spec, assumé :** le masquage des champs sensibles dans `auditLog` (tâche 3). La spec ne l'avait pas anticipé ; il découle directement du fait que `/api/admin/payout` est la première route à combiner `auditLog` et `requireOtp`, ce qui aurait écrit le code OTP en clair dans `audit_logs`.

**Cohérence des noms :** `getPayoutDestinationId` / `resetPayoutDestinationCache` (tâche 1) sont utilisés sous ces noms exacts en tâche 5. `OTP_THRESHOLDS` et `REQUIRED_BODY_FIELDS` (tâche 2) sont consommés sous ces noms en tâches 2 et 5. `getPlatformBalance` / `createPayout` (tâches 4 et 5) correspondent aux imports d'`adminRoutes.js`.

**Comptes de tests attendus :** 87 avant le chantier → 92 (T1) → 101 (T2) → 106 (T3) → 109 (T4) → 113 (T5, +7 : le fichier `payout.test.js` en compte 10 au total).
