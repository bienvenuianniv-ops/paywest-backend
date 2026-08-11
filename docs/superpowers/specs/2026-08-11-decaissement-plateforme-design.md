# Décaissement des revenus plateforme — Design

## Contexte

Depuis le 2026-08-10, le moteur de frais crédite un compte `role='platform'` à
chaque transfert P2P. Ces revenus s'accumulent dans un wallet sans aucun moyen
d'en sortir : aucune route ne débite ce compte, et son rôle n'est pas
`customer`, donc il ne passerait de toute façon pas par les parcours clients.

Ce design ajoute la sortie manquante.

**Découverte faite en explorant, qui a orienté toute la conception :**
`withdrawToWave` et `withdrawToOrange` (`src/controllers/withdrawController.js`)
ne décaissent rien réellement. Ils construisent une URL
`https://api.wave.com/v1/payout?...` qui n'est jamais appelée, débitent le
wallet et laissent la transaction en `pending`. **PayWest n'a aujourd'hui aucun
rail de sortie d'argent réel.** Décaisser « vers Wave » aurait donc produit une
écriture comptable sans contrepartie — l'option est écartée.

## Portée

Ajouté :
- `GET /api/admin/platform-balance` — consultation du solde plateforme
- `POST /api/admin/payout` — transfert interne du wallet plateforme vers un
  compte PayWest fixe

Volontairement hors périmètre :
- Tout rail de sortie d'argent réel (Wave, Orange, virement bancaire)
- Tout plafond ou fréquence maximale de décaissement
- Toute interface d'administration
- Toute modification des routes de retrait existantes

## Décisions de cadrage

| Question | Décision |
|---|---|
| Destination | Transfert **interne** vers un wallet PayWest. La somme des wallets reste inchangée ; la sortie réelle se fait ensuite depuis ce compte, hors système. |
| Bénéficiaire | Compte fixe résolu par la variable d'environnement `PAYOUT_DESTINATION_EMAIL`, **jamais lu dans la requête**. |
| Protection | OTP SMS **systématique**, quel que soit le montant. |
| Plafonds BCÉAO | Non appliqués : ils encadrent les transferts clients, un mouvement interne de trésorerie n'entre pas dans leurs sommes. |
| Frais | Aucun. `computeFee()` ne concerne que les transferts P2P. |

### Pourquoi un bénéficiaire fixe et non un paramètre de requête

Un compte admin compromis peut alors déclencher un décaissement, mais pas le
détourner : l'argent ne peut aller que vers le compte configuré côté serveur.
Changer la destination exige un accès aux variables d'environnement Render,
pas un JWT.

### Pourquoi un OTP à tout montant

Les usages clients ont un seuil de 100 000 XOF parce qu'un SMS à chaque petit
transfert serait insupportable. Le décaissement est une opération rare, faite
par un humain : le coût du code est nul, et il ferme le scénario « JWT admin
volé, wallet plateforme vidé en une requête ».

## Architecture

### `src/services/payoutDestination.js`

Calqué sur `platformAccount.js` : résout l'id du bénéficiaire depuis
`PAYOUT_DESTINATION_EMAIL` une seule fois et le mémorise.

- Variable absente → erreur explicite
- Email inconnu en base → erreur explicite
- Compte résolu = compte plateforme → erreur explicite (configuration
  incohérente : la plateforme se paierait elle-même)
- `resetPayoutCache()` réservé aux tests, comme `resetPlatformCache()`

Vérification au démarrage dans le bloc `require.main === module` de
`src/index.js`, **exactement** sur le modèle existant : `.then` qui logue l'id
résolu, `.catch` qui logue l'erreur. Jamais de `throw` au démarrage — une
variable oubliée ne doit pas couper l'API de paiement, seule la route de
décaissement doit tomber.

### `src/controllers/payoutController.js`

Contrôleur dédié, et non une extension d'`adminController.js` : ce dernier fait
déjà 230 lignes et ne contient aucune logique monétaire. Mélanger les deux
mettrait du déplacement d'argent dans un fichier de lecture/administration.

- `getPlatformBalance` — solde du wallet plateforme
- `createPayout` — un seul `BEGIN … COMMIT` sur le modèle exact de
  `transactionController.send` : débit plateforme, crédit bénéficiaire,
  `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)`
  avec `type='payout'` et `status='completed'`

`transactions.type` est un `VARCHAR(20)` sans contrainte `CHECK` (vérifié dans
`initDb.js`) : `payout` ne demande **aucune migration**. La colonne `fee` est
`NOT NULL DEFAULT 0`, donc l'`INSERT` peut l'omettre — un décaissement porte
bien `fee = 0`.

### Routes

Déclarées dans `adminRoutes.js`, chaîne complète :

```
adminOnly → auditLog('admin_payout') → idempotency('admin.payout')
          → validatePayoutAmount → requireOtp('admin.payout') → createPayout
```

L'ordre reprend celui des routes monétaires existantes : l'audit enregistre
l'intention avant toute vérification, l'idempotence protège du double envoi, et
l'OTP est la dernière porte avant le contrôleur.

`validatePayoutAmount` est un middleware et non un test en tête de contrôleur
parce que `requireOtp` s'exécute **avant** le contrôleur : un montant à virgule
comme `1500.5` est fini et strictement supérieur au seuil `0`, donc sans
validation préalable il déclencherait un défi OTP — et un vrai SMS — avant
d'être rejeté. La validation n'existe qu'à un seul endroit ; le contrôleur ne
la répète pas.

`GET /api/admin/platform-balance` ne porte que `adminOnly` + `auditLog`.

### Garde-fous du contrôleur

- `amount` entier strictement positif
- `amount ≤ solde plateforme`, refus détaillant solde et montant demandé
- Bénéficiaire ≠ compte plateforme (redondant avec le service, gardé comme
  ceinture et bretelles sur une opération monétaire)

## Modifications de l'OTP existant

C'est le premier chantier qui touche `requireOtp.js`, fichier audité trois fois
et laissé intact par le moteur de frais. Trois changements, tous additifs.

### 1. Seuil paramétrable par usage

```js
const OTP_THRESHOLDS = {
  'transactions.send': 100000,
  'withdraw.wave': 100000,
  'withdraw.orange': 100000,
  'admin.payout': 0
};
```

La comparaison reste `amount <= seuil → next()` : un seuil à `0` signifie « tout
montant strictement positif exige un code », sans cas particulier dans le code.

`OTP_THRESHOLD` (constante unique actuelle) est exporté mais **importé par aucun
fichier source** — vérifié, seul le plan de 2026-08-09 le cite. Son
remplacement ne casse aucun consommateur.

Le garde `!Number.isFinite(amount)` est conservé tel quel : un `amount` non
numérique saute l'OTP et tombe sur le 400 du contrôleur. Rien ne bouge, mais le
comportement est contre-intuitif pour un usage à seuil `0` — il est verrouillé
par un test explicite plutôt que par un commentaire.

### 2. Binding

```js
'admin.payout': (body) => `${body.amount}:payout`
```

La destination étant fixe, le montant identifie seul l'opération. Deux
décaissements successifs du même montant fonctionnent : le premier code est
marqué `used_at`, et `alreadyChallenged` filtre sur
`used_at IS NULL AND expires_at > NOW()` depuis le correctif de la passe 3.

### 3. Champs de body requis par usage

`otpController.js:22` fait aujourd'hui :

```js
const targetField = purpose === 'transactions.send' ? 'receiver_phone' : 'phone';
```

Ajouter `'admin.payout'` à `BINDING_FIELDS` le rend automatiquement accepté par
`isValidPurpose`, donc un renvoi de code pour un décaissement réclamerait un
`phone` bidon qui n'entre même pas dans le binding.

Remplacé par une table exportée depuis `requireOtp.js`, à côté de
`BINDING_FIELDS` :

```js
const REQUIRED_BODY_FIELDS = {
  'transactions.send': ['receiver_phone'],
  'withdraw.wave': ['phone'],
  'withdraw.orange': ['phone'],
  'admin.payout': []
};
```

`resendOtp` itère dessus. Le ternaire disparaît, et le piège ne se represente
pas au prochain usage ajouté.

Note : `/api/otp/resend` reste ouvert à tout compte authentifié, y compris avec
`purpose='admin.payout'`. Aucune fuite — le renvoi exige un défi actif pour
`req.user.id`, donc un non-admin reçoit un 404.

## Réponses d'erreur

| Situation | Réponse |
|---|---|
| Pas admin | 403 (`verifyRole`) |
| `amount` absent, non entier ou ≤ 0 | 400 |
| Solde plateforme insuffisant | 400 + `{ balance, amount }` |
| Bénéficiaire non résolu (variable absente ou email inconnu) | 500, message « compte de destination non configuré », loggé |
| Bénéficiaire = compte plateforme | 500 (configuration incohérente, jamais une erreur de l'appelant) |
| OTP manquant, ou défi déjà envoyé | 403 `otp_required` |
| OTP faux ou expiré | 401 `otp_invalid` |
| Échec d'envoi du SMS | 502 |
| Rejeu d'`Idempotency-Key` | réponse mise en cache, ou 409 si concurrente |

Aucun vocabulaire nouveau : ce sont les codes des routes monétaires existantes.

## Traçabilité

- `auditLog('admin_payout')` alimente `audit_logs`, lisible via
  `GET /api/admin/audit`
- **Masquage ajouté au passage** : `auditLog` enregistre `req.body`
  intégralement. `/api/admin/payout` est la première route à combiner
  `auditLog` et `requireOtp`, donc sans correctif le code OTP d'un
  décaissement réussi serait écrit en clair dans `audit_logs`. Le middleware
  masque désormais `otp_code`, `password`, `new_password`, `old_password` et
  `pin`. Le code est déjà consommé au moment où la ligne est écrite,
  l'exposition est donc faible — mais un secret d'authentification en clair
  dans un journal consultable est une mauvaise base à poser.
- La ligne `transactions` de type `payout` (`sender_id` = plateforme,
  `receiver_id` = bénéficiaire) est la trace comptable
- `logger.info` au succès : montant, admin appelant, soldes après opération
- Sentry capte les 500 comme partout ailleurs

## Tests

`src/tests/payout.test.js`, code OTP lu depuis le mock `sendOtpSMS` comme dans
`otp.test.js` :

1. Compte non-admin → 403, aucun mouvement
2. Montant de 1 XOF → 403 `otp_required` + SMS envoyé — **le** test qui échoue
   si le seuil de 100 000 s'appliquait encore
3. Bon code → 200 : plateforme −X, bénéficiaire +X, somme des wallets
   inchangée, ligne `type='payout'` créée ; puis annulation exacte (recrédit,
   débit, `DELETE` par id) sur le modèle de `reverseTransfer`
4. Montant supérieur au solde plateforme → 400 détaillant solde et montant,
   aucun mouvement
5. Montant invalide (0, négatif, non entier, non numérique) → 400, aucun SMS
6. Mauvais code → 401, aucun mouvement
7. Non-régression : les trois usages clients conservent leur seuil de 100 000

Discipline imposée par le projet :
- Jamais de `pool.end()` dans un fichier de test (pool singleton partagé entre
  fichiers dans le même worker Jest)
- `afterEach` qui purge `otp_codes WHERE purpose='admin.payout'`
- Zéro dérive de solde sur `paywest_test` : chaque test qui déplace de l'argent
  l'annule exactement

## Documentation

Blocs Swagger sur les deux routes, dans le tag `Administration` existant.

## Configuration et mise en production

`PAYOUT_DESTINATION_EMAIL` à poser dans :
- `.env` (local)
- `.env.example`
- la liste de variables obligatoires de `src/tests/setup.js`
- les variables d'environnement Render (production)

Ordre de déploiement :

1. Variable posée sur Render, **relue et comparée par empreinte** (une écriture
   qui renvoie 200 ne prouve rien)
2. `POST /v1/services/{id}/deploys` — jamais un restart, il ne réapplique pas
   la configuration d'environnement
3. Attente du statut `live`, vérification des logs de build et de démarrage et
   de `GET /`
4. Preuve de bout en bout en production sur un petit montant, puis annulation
   exacte — comme pour le moteur de frais, et uniquement avec l'accord
   explicite de l'utilisateur au moment de le faire

La résolution au démarrage ne faisant jamais crasher le process, l'ordre
1 → 2 est une précaution, pas une contrainte de sécurité.
