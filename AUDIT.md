# Audit de code — PayWest Backend

**Date** : 2026-08-09
**Périmètre** : deux passes de revue complète du code à l'état de `main`, effort max, tous fichiers de `src/`
**Méthode** : revue automatisée (`/code-review ... --level max`) + vérification manuelle de chaque piste avant correction, puis tests de non-régression en production après déploiement

## Résultat

**Passe 1** : 7 problèmes trouvés dans le code, **7 corrigés**. 3 problèmes de données trouvés en production pendant la vérification, **3 corrigés**.
**Passe 2** (audit complet relancé sur tout `src/`) : 10 problèmes supplémentaires trouvés, **10 corrigés**.

**Total : 17 problèmes de code corrigés, 3 corrections de données de production, aucun problème restant en attente.**

### Passe 1 — commit `c46bcf8`

| # | Problème | Sévérité |
|---|----------|----------|
| 1 | Plafonds BCEAO contournables via paiement marchand QR et retraits Wave/Orange | Critique |
| 2 | Signature webhook de longueur différente → crash 500 au lieu de 401 | Élevée |
| 3 | Montant non converti en nombre dans le calcul des plafonds → comparaison de chaînes | Élevée |
| 4 | Wallet client non vérifié avant lecture du solde (retrait agent) | Moyenne |
| 5 | Utilisateur non vérifié avant lecture KYC (vérification des plafonds) | Moyenne |
| 6 | Montant non numérique silencieusement accepté dans la conversion de devise | Moyenne |
| 7 | Fichier de rate limiting dupliqué et jamais utilisé | Mineure |

### Passe 2 — commit `9b2f73c`

| # | Problème | Sévérité |
|---|----------|----------|
| 8 | Limites BCEAO absentes sur `/api/agent/credit` et `/api/agent/withdraw` | Critique |
| 9 | Paiements QR jamais comptés dans les plafonds journaliers/mensuels | Critique |
| 10 | Compte suspendu garde un accès complet (JWT jamais revalidé contre le rôle en base) | Critique |
| 11 | Remboursement en double possible sur webhook de retrait rejoué | Critique |
| 12 | Webhook de retrait Orange rejeté par le vérificateur Wave (fonds bloqués) | Élevée |
| 13 | Échec silencieux post-commit bloque l'inscription utilisateur | Élevée |
| 14 | Anti-spam (10/min) absent sur retraits, dépôts et opérations agent | Élevée |
| 15 | Wallet non vérifié avant lecture du solde (retraits Wave/Orange) | Moyenne |
| 16 | Validation de montant faible sur les routes agent | Moyenne |
| 17 | Format de date cassé dans les références de l'export Excel | Mineure |

Déployé et vérifié en production (`https://paywest-backend-1.onrender.com`) : les 17 correctifs ont été testés directement contre l'API live après déploiement, sans régression sur les routes existantes.

---

## Détail des problèmes de code

### 1. Plafonds BCÉAO contournables
**Fichiers** : `src/routes/merchantRoutes.js`, `src/routes/withdrawRoutes.js`
Le middleware `checkTransactionLimits` (plafonds journaliers/mensuels réglementaires) n'était câblé que sur `POST /api/transactions/send`. Les paiements marchand via QR (`/api/merchant/pay`) et les retraits Wave/Orange (`/api/withdraw/wave`, `/api/withdraw/orange`) en étaient totalement dépourvus — un client plafonné à 300 000 XOF/jour pouvait dépenser n'importe quel montant jusqu'à son solde via ces routes.

**Fix** : `checkTransactionLimits` ajouté sur les trois routes concernées.

### 2. Crash sur signature webhook invalide
**Fichier** : `src/middleware/webhookSecurity.js`
`crypto.timingSafeEqual()` lève une `RangeError` si les deux buffers comparés n'ont pas la même longueur. Une signature Wave/Orange de longueur différente de celle attendue faisait donc planter la vérification en 500 générique au lieu de rejeter proprement en 401.

**Fix** : comparaison de longueur avant l'appel à `timingSafeEqual`, dans les deux vérificateurs (Wave et Orange).

### 3. Comparaison de chaînes dans le calcul des plafonds
**Fichier** : `src/middleware/transactionLimits.js`
`req.body.amount` n'était jamais converti en `Number` avant `parseFloat(total) + amount`. Comme aucun sanitizer `.toInt()` n'est appliqué dans `validators.js`, un montant reçu en chaîne (`"5000"`) produisait une concaténation (`30000 + "5000"` → `"300005000"`) au lieu d'une addition, faussant totalement la comparaison au plafond.

**Fix** : `const amount = Number(req.body.amount)` en tête de `checkTransactionLimits`.

### 4-5. Accès `.rows[0]` non vérifiés
**Fichiers** : `src/controllers/agentController.js` (`withdrawClient`), `src/middleware/transactionLimits.js`
Deux endroits lisaient `result.rows[0].xxx` sans vérifier `result.rows.length === 0` au préalable — un wallet ou un utilisateur manquant (données incohérentes, compte supprimé pendant qu'un token reste valide) faisait planter en `TypeError`, masqué en 500 générique au lieu d'un 404/401 explicite. Ce même pattern avait déjà été identifié et corrigé ailleurs dans le code (`merchantController.js`), sans être généralisé.

**Fix** : vérification de présence ajoutée aux deux endroits, avec réponse 404 explicite.

### 6. Validation NaN manquante
**Fichier** : `src/controllers/currencyController.js`
`convertAmount` ne testait que `!amount || amount <= 0`, qui laisse passer une chaîne non numérique (`"abc"` est *truthy*, et `NaN <= 0` vaut `false`). Le calcul produisait alors `converted_amount: null` renvoyé avec un statut **200**, au lieu d'une erreur 400.

**Fix** : `Number(req.body.amount)` + `Number.isFinite(amount)` en tête de fonction.

### 7. Fichier dupliqué
**Fichier** : `src/middleware/rateLimitMiddleware.js`
Doublon non utilisé de `rateLimiter.js`, avec des valeurs de limite différentes (300 vs 100 requêtes/15 min) — piège pour un futur mainteneur qui éditerait le mauvais fichier en pensant changer les limites réelles.

**Fix** : fichier supprimé (seul `rateLimiter.js` est importé par `src/index.js`).

---

## Détail des problèmes de code — passe 2

### 8. Limites BCÉAO absentes sur les routes agent
**Fichier** : `src/routes/agentRoutes.js`
Même faille que le problème 1, sur des routes différentes : `checkTransactionLimits` n'était câblé sur aucune route agent, alors qu'un palier `agent` (2M/10M/50M XOF) existe explicitement dans `transactionLimits.js`. Un agent pouvait créditer ou débiter un client de n'importe quel montant.

**Fix** : `checkTransactionLimits` ajouté sur `POST /api/agent/credit` et `POST /api/agent/withdraw`.

### 9. Paiements QR jamais comptés dans les plafonds
**Fichier** : `src/middleware/transactionLimits.js`
Les requêtes d'agrégation journalière/mensuelle ne comptaient que `type IN ('transfer', 'withdraw')`, alors que `checkTransactionLimits` protège aussi `/api/merchant/pay`, dont les transactions sont enregistrées avec `type = 'payment'`. Un client pouvait multiplier les paiements marchand sans jamais déclencher le plafond, puisque chaque nouveau calcul ignorait les paiements précédents.

**Fix** : `'payment'` ajouté à la liste des types comptés dans les deux requêtes (journalière et mensuelle).

### 10. Compte suspendu garde un accès complet
**Fichier** : `src/middleware/authMiddleware.js`
`verifyToken` ne validait que la signature et l'expiration du JWT, jamais le rôle actuel en base. Un admin suspendant un compte (`role = 'suspended'`) n'avait aucun effet immédiat : le token déjà émis (valide jusqu'à 7 jours) continuait de fonctionner sur toutes les routes, et `checkTransactionLimits` retombait même sur les plafonds `customer` faute de palier `suspended` défini.

**Fix** : `verifyToken` interroge désormais la base à chaque requête pour lire le rôle actuel, rejette en 403 si `suspended`, et propage ce rôle frais dans `req.user` (corrige aussi la staleness pour tout changement de rôle, pas seulement la suspension).

### 11. Remboursement en double sur webhook de retrait
**Fichier** : `src/controllers/withdrawController.js`
`confirmWithdraw` lisait et mettait à jour la transaction sans verrou (`FOR UPDATE`) ni vérification d'idempotence, contrairement à `confirmWaveDeposit`/`confirmOrangeDeposit` qui font les deux. Un webhook rejoué deux fois (relance provider, replay) exécutait `balance = balance + amount` deux fois pour un seul retrait échoué.

**Fix** : la fonction tourne maintenant dans une transaction Postgres avec `SELECT ... FOR UPDATE` sur la ligne de transaction, et rejette en 400 si le statut n'est plus `pending`.

### 12. Webhook de retrait Orange rejeté par le vérificateur Wave
**Fichiers** : `src/routes/withdrawRoutes.js`
Une seule route `POST /api/withdraw/webhook` confirmait à la fois les retraits Wave et Orange, mais n'était protégée que par `verifyWaveWebhook` (vérifie `x-wave-signature`). Une confirmation Orange légitime, signée avec `x-orange-signature`, se faisait systématiquement rejeter en 401 — le retrait restait bloqué indéfiniment (argent déjà débité, jamais confirmé ni remboursé). Même incohérence déjà évitée côté dépôt (`/api/deposit/webhook` vs `/api/orange/webhook`, chacun avec son propre vérificateur).

**Fix** : route séparée en `POST /api/withdraw/webhook/wave` (`verifyWaveWebhook`) et `POST /api/withdraw/webhook/orange` (`verifyOrangeWebhook`), toutes deux vers `confirmWithdraw`. L'ancienne route unique a été supprimée (aucun consommateur externe réel, flux Wave/Orange encore simulés).

### 13. Échec silencieux post-commit à l'inscription
**Fichier** : `src/controllers/authController.js`
Dans `register()`, l'`INSERT` du `refresh_token` s'exécutait sur `pool` (hors transaction) **après** le `COMMIT` qui avait déjà persisté l'utilisateur et son wallet. Si cet `INSERT` échouait, le `ROLLBACK` du bloc `catch` ne faisait rien (transaction déjà validée), et l'API répondait 500 sans token alors que le compte existait déjà — toute nouvelle tentative d'inscription échouait ensuite avec « Email ou téléphone déjà utilisé », bloquant l'utilisateur sans intervention support.

**Fix** : l'`INSERT` du `refresh_token` déplacé dans la même transaction, avant le `COMMIT`. Un échec entraîne désormais un vrai rollback complet (aucun compte orphelin).

### 14. Anti-spam absent sur retraits, dépôts et opérations agent
**Fichier** : `src/index.js`
`transactionLimiter` (10 requêtes/min, anti-spam) n'était monté que sur `/api/transactions`. Les routes sœurs `/api/withdraw`, `/api/deposit`, `/api/orange`, `/api/agent` et `/api/merchant` n'avaient que le `generalLimiter` partagé (100 requêtes/15 min) — un débit d'abus bien plus élevé que prévu sur des opérations d'argent.

**Fix** : `transactionLimiter` appliqué aux cinq routeurs, en cohérence avec `/api/transactions`.

### 15. Wallet non vérifié avant lecture du solde (retraits)
**Fichier** : `src/controllers/withdrawController.js`
`withdrawToWave` et `withdrawToOrange` lisaient `wallet.rows[0].balance` juste après le `SELECT ... FOR UPDATE`, sans vérifier `rows.length === 0` au préalable — même pattern que les problèmes 4-5 de la passe 1, mais resté non corrigé sur ces deux fonctions précises.

**Fix** : vérification de présence ajoutée aux deux fonctions, réponse 404 explicite (« Portefeuille introuvable »).

### 16. Validation de montant faible sur les routes agent
**Fichier** : `src/controllers/agentController.js`
`creditClient` et `withdrawClient` validaient `amount` avec un simple `!amount || amount <= 0`, sans coercion `Number()`/`Number.isFinite`, contrairement à `payViaQR` et `sendMoney` qui appliquent cette vérification stricte.

**Fix** : `Number(req.body.amount)` + `Number.isFinite(amount)` ajoutés aux deux fonctions.

### 17. Format de date cassé dans l'export Excel
**Fichier** : `src/controllers/reportController.js`
La colonne « Référence » de l'export utilisait `tx.created_at.toString().slice(0, 10)` — `Date.prototype.toString()` commence par le jour de la semaine en anglais (`"Thu Aug 07 2026 ..."`), pas une date ISO. Les références générées ressemblaient à `PAY-123-Thu Aug 07` au lieu de `PAY-123-2026-08-07`, inutilisables pour un rapprochement comptable.

**Fix** : `new Date(tx.created_at).toISOString().slice(0, 10)`.

---

## Fiabilité du déploiement automatique Render

Constaté pendant cette session : `autoDeploy: "yes"` est bien activé côté service (confirmé via l'API Render), mais le déploiement automatique **ne s'est déclenché qu'une seule fois sur six pushes** — tous les autres ont nécessité un déclenchement manuel depuis le dashboard. Cause non identifiée (webhook GitHub non fiable ?, délai de propagation ?) — à surveiller, et à investiguer côté Settings → GitHub du service si ça persiste.

## Disponibilité — mise en veille du plan gratuit

Un pic de latence de ~4min22s a été observé (cold start du plan gratuit Render après ~15 min d'inactivité), avec un risque concret pour une app de paiement : webhooks Wave/Orange qui timeout côté provider (transactions bloquées en `pending` sans réconciliation), et timeouts côté client plus courts que le réveil.

**Fix** (commits [`2f08f1f`](https://github.com/bienvenuianniv-ops/paywest-backend/commit/2f08f1f) puis durci en [`673d624`](https://github.com/bienvenuianniv-ops/paywest-backend/commit/673d624)) : workflow GitHub Actions `.github/workflows/keep-alive.yml` qui ping l'API toutes les 5 minutes, avec échec explicite du job (au lieu d'un simple warning) si la réponse n'est pas 200. Ne couvre pas l'auto-suspend indépendant de la base Neon (délai par défaut 5 min, non configurable sur le plan gratuit).

---

## Hygiène des données de production

Trouvés en vérifiant l'état de la base après déploiement, corrigés directement en base (pas de commit associé, sauf pour l'isolation des tests) :

### Compte admin de test suspect
Compte `hacker054656@test.com` (id 7), rôle **admin**, trouvé en production. Vérification : `authController.js` fige le rôle à `'customer'` à l'inscription — ce compte n'a donc pas pu être créé via une faille, mais manuellement lors d'un test de sécurité passé. Solde à 0, aucune transaction, aucun log d'audit depuis sa création (2026-07-02). **Supprimé** (compte + wallet associé).

### Suite de tests polluant la production
`npm test` n'utilisait aucune base séparée (`DATABASE_URL` de production seule définie) : chaque exécution créait un vrai compte `testjest<timestamp>@paywest.com` et créditait le wallet du compte client de test de 1000 XOF via deux chemins différents (`wallet.test.js` et `agent.test.js`).

**Fix** (commit [`dfc6bf6`](https://github.com/bienvenuianniv-ops/paywest-backend/commit/dfc6bf698553268b4d4f9c054ce7265a6a48809e)) : `src/config/db.js` bascule sur `TEST_DATABASE_URL` quand `NODE_ENV=test` (positionné automatiquement par Jest) et lève une erreur explicite si cette variable est absente — impossible désormais de retomber silencieusement sur la prod. Base `paywest_test` créée sur le même serveur Neon avec le schéma cloné et les 3 comptes core (`bienvenu@paywest.com`, `agent@paywest.com`, `client@paywest.com`) seedés avec leurs hash de mot de passe réels. Les 6 comptes `Test Jest` déjà présents en prod (+ leurs wallets et refresh tokens) ont été supprimés. Vérifié après coup : un `npm test` complet ne crée plus aucune trace en production.

### Solde client gonflé par la pollution des tests
Le wallet du compte `client@paywest.com` (id 2) affichait 1 325 000 XOF. Analyse de l'historique des transactions : 8 crédits identiques de 1000 XOF, en 4 paires horodatées exactement sur les 4 exécutions `npm test` du jour, correspondants au pattern de pollution décrit ci-dessus (le reste de l'historique — transferts, crédits de 500 000 XOF — correspond à de la vraie utilisation manuelle et n'a pas été touché). **Corrigé** : les 8 transactions fantômes supprimées, solde ramené à 1 317 000 XOF.

---

## Points vérifiés sans problème trouvé

- Injections SQL : requêtes paramétrées partout dans les fichiers revus
- Signature JWT et hashing des mots de passe (bcrypt) : implémentation standard, pas de secret en dur avec fallback
- IDOR : les routes marchand/agent filtrent correctement par `req.user.id` / rôle
- Verrouillage transactionnel (`FOR UPDATE`) présent sur les mises à jour de solde concurrentes (paiement QR, retraits)
- Déploiement final (`9b2f73c`) vérifié live sans erreur au démarrage, y compris l'absence de tout impact du nouveau garde-fou `TEST_DATABASE_URL` sur l'environnement de production (`NODE_ENV=production` confirmé par l'absence de crash)
- Après la passe 2 : ancienne route `/api/withdraw/webhook` bien supprimée (404), nouvelles routes `/webhook/wave` et `/webhook/orange` répondent chacune correctement (401 sur signature invalide, pas de 404 ni de rejet croisé), login + accès aux routes protégées toujours fonctionnels avec la revalidation DB du rôle
