# Moteur de frais sur transferts P2P — Design

## Contexte

PayWest déplace aujourd'hui de l'argent gratuitement. La seule notion de frais
du code se trouve dans `currencyController.js` (conversion de devises) ; la
table `transactions` n'a pas de colonne de frais et aucune opération ne génère
de revenu. Ce design ajoute un prélèvement sur les transferts entre
particuliers, seul poste facturé retenu.

La décision de le faire maintenant plutôt que plus tard tient à une raison
technique : chaque transaction enregistrée sans colonne `fee` est une ligne à
migrer par la suite.

## Portée

Facturé :
- `POST /api/transactions/send` (transfert P2P)

Gratuit, décision explicite :
- Dépôts (`/api/deposit`, `/api/orange`, `/api/agent/credit`)
- Retraits (`/api/withdraw/wave`, `/api/withdraw/orange`, `/api/agent/withdraw`)
- Paiement marchand QR (`/api/merchant/pay`)

Une seule route porte donc la logique de prélèvement.

## Décisions de cadrage

| Question | Décision |
|---|---|
| Qui supporte les frais | L'expéditeur, **en plus** du montant. Le destinataire reçoit le montant saisi au centime près. |
| Structure du barème | Paliers à montant fixe (modèle Orange Money/MTN). |
| Destination des frais | Wallet d'un compte plateforme dédié, crédité dans la même transaction SQL. |
| Emplacement de la grille | Constante de code dans un service isolé, pas de table ni de route admin. |
| Impact sur les plafonds/OTP | Aucun : plafonds BCÉAO et seuil OTP continuent de porter sur le montant transféré seul. |

### Pourquoi l'expéditeur paie en plus

C'est le modèle Wave/Orange Money : le montant saisi est celui qui arrive, donc
aucune surprise côté destinataire. Conséquence à ne pas manquer — la
vérification de solde doit porter sur `montant + frais`, pas sur le montant.

### Pourquoi une grille en code et non en base

Une route admin modifiant une règle monétaire est une surface d'attaque réelle :
un compte admin compromis se fabrique un barème à 100 %. La grille en constante
suit le pattern déjà en place dans `transactionLimits.js` (`LIMITS` est en dur),
est versionnée dans git (traçabilité de qui change quoi, gratuitement), se teste
sans base, et ne coûte ni table ni migration ni requête SQL supplémentaire par
transfert. Le déploiement automatique Render étant fiable depuis la correction
du 2026-08-09, changer un tarif reste un commit.

`computeFee()` est une frontière propre : basculer la grille en base plus tard
change l'intérieur du service sans toucher aucun contrôleur.

## Barème

| Montant (XOF) | Frais (XOF) |
|---|---|
| 0 – 5 000 | 100 |
| 5 001 – 25 000 | 250 |
| 25 001 – 50 000 | 500 |
| 50 001 – 100 000 | 1 000 |
| 100 001 – 500 000 | 2 500 |
| > 500 000 | 5 000 |

Bornes **inclusives des deux côtés**, grille contiguë sans trou ni
chevauchement : 5 000 relève du premier palier, 5 001 du deuxième. Les montants
étant fixes et entiers, il n'y a aucun arrondi à gérer.

## Composants

### `src/services/feeService.js` (nouveau)

Fonction pure, aucun accès base :

```js
const FEE_TIERS = [
  { min: 0,      max: 5000,     fee: 100  },
  { min: 5001,   max: 25000,    fee: 250  },
  { min: 25001,  max: 50000,    fee: 500  },
  { min: 50001,  max: 100000,   fee: 1000 },
  { min: 100001, max: 500000,   fee: 2500 },
  { min: 500001, max: Infinity, fee: 5000 }
];

computeFee(amount) → entier XOF
```

`computeFee` lève une erreur sur une entrée non finie ou négative (défense en
profondeur : `sendMoney` valide déjà en amont).

### `src/services/platformAccount.js` (nouveau)

Résout l'`id` du compte plateforme par `role = 'platform'` et le mémorise en
module — une requête au démarrage, pas une par transfert. Lève une erreur
explicite si le compte est absent.

La résolution est déclenchée au démarrage depuis `index.js`, **à l'intérieur du
bloc `if (require.main === module)`** : une requête exécutée au moment de
l'import ferait une connexion base dans chaque fichier de test (qui importe
`app` sans le démarrer). La résolution paresseuse au premier transfert reste en
filet si l'amorçage a été contourné.

### `src/controllers/feeController.js` + `src/routes/feeRoutes.js` (nouveaux)

Deux routes en lecture seule, montées sur `/api/fees` :

- `GET /api/fees` → la grille complète, pour affichage dans l'app
- `GET /api/fees/quote?amount=50000` →
  ```json
  { "amount": 50000, "fee": 500, "total_debit": 50500, "receiver_gets": 50000 }
  ```
  Appelée avant confirmation pour afficher le coût réel à l'utilisateur.
  `amount` absent, non numérique ou ≤ 0 → `400`.

Authentification : `verifyToken`, comme les autres routes de consultation. Le
`generalLimiter` monté sur `/api` s'applique déjà.

### `src/controllers/transactionController.js` (modifié)

Intègre le prélèvement dans `sendMoney` (voir flux ci-dessous).

## Modèle de données

### Colonne de frais

```sql
ALTER TABLE transactions ADD COLUMN fee DECIMAL(15,2) NOT NULL DEFAULT 0;
```

Les lignes existantes prennent `0`, ce qui est exact et non une approximation :
aucun transfert passé n'a supporté de frais. Aucun backfill à écrire.

### Compte plateforme

Ligne `users` + `wallets` seedée par `initDb.js` de façon idempotente
(`ON CONFLICT DO NOTHING`), comme les trois tables ajoutées lors de la passe 3
d'audit :

| Champ | Valeur | Raison |
|---|---|---|
| `role` | `platform` | Distingue le compte système ; sert de clé de résolution. |
| `email` | `platform@paywest.internal` | Domaine non routable, aucun email réel ne peut y arriver. |
| `phone` | `PLATFORM-ACCOUNT` | Non numérique. |
| `password` | `*` | N'est pas un hash bcrypt valide. |

Les deux dernières valeurs méritent une explication :

- **`password = '*'`** : `bcrypt.compare` renvoie systématiquement `false` face à
  une chaîne qui n'est pas un hash valide. Le compte n'est connectable par
  personne, y compris l'administrateur. C'est la convention Unix du compte
  verrouillé.
- **`phone = 'PLATFORM-ACCOUNT'`** : le validateur impose `^\+?[0-9]{8,15}$` sur
  `phone` (inscription) **et** sur `receiver_phone` (transfert). Une valeur non
  numérique est donc structurellement impossible à inscrire *et* impossible à
  cibler par un transfert — plus solide qu'un numéro réservé, qui resterait un
  numéro valide.

Piège d'implémentation à ne pas manquer : `INSERT … ON CONFLICT DO NOTHING
RETURNING id` ne renvoie **aucune ligne** quand le compte existe déjà. Le seed
doit donc faire suivre l'insertion d'un `SELECT` pour récupérer l'`id` dans les
deux cas, sinon la création du wallet associé échouera silencieusement à partir
du deuxième lancement d'`initDb.js`.

Le rôle `platform` est absent de `LIMITS` dans `transactionLimits.js` et
retomberait sur les limites `customer`. Sans effet ici puisque le compte ne peut
pas se connecter et n'émet donc jamais de transaction, mais à garder en tête si
un usage sortant lui est donné un jour.

## Flux de `sendMoney`

```
fee   = computeFee(amount)          ← pur, calculé hors transaction
total = amount + fee

BEGIN
  résolution du destinataire                    (inchangé)
  refus de l'auto-envoi                         (inchangé)
  SELECT wallet expéditeur FOR UPDATE
  si balance < total → ROLLBACK + 400
  UPDATE wallet expéditeur    −= total
  UPDATE wallet destinataire  += amount
  UPDATE wallet plateforme    += fee            ← en dernier, volontairement
  INSERT transactions (…, amount, fee)
COMMIT
```

**Ordre du crédit plateforme.** Cette ligne de wallet est touchée par *tous* les
transferts : son verrou sérialise les transactions concurrentes jusqu'au
`COMMIT`. La placer en dernier réduit la durée de détention au minimum. Effet
imperceptible au volume actuel, mais un goulot d'étranglement coûteux à corriger
après coup si elle est mal placée. C'est le prix assumé de la cohérence
comptable retenue.

Si `fee` vaut 0 (impossible avec la grille actuelle, possible avec une grille
future), l'`UPDATE` plateforme est sauté plutôt qu'exécuté avec `+= 0`.

### Réponses

Solde insuffisant — le message actuel « Solde insuffisant » deviendrait
incompréhensible (solde 50 200, envoi 50 000 : l'utilisateur a « assez ») :

```json
{ "message": "Solde insuffisant : 50 500 XOF requis",
  "amount": 50000, "fee": 500, "total_required": 50500, "balance": 50200 }
```

Succès — `fee` et `total_debit` s'ajoutent à la transaction retournée, pour que
l'app produise un reçu exact sans recalculer. Le nom `total_debit` est identique
à celui du devis, pour que l'app lise le même champ des deux côtés.

## Ce qui ne change pas

Aucun des trois mécanismes déjà audités n'est retouché :

- `checkTransactionLimits` continue de lire `req.body.amount` : les plafonds
  BCÉAO portent sur le montant transmis, pas sur la commission de la plateforme.
- `requireOtp` et son binding `sha256(montant + destinataire)` restent intacts :
  le seuil de 100 000 XOF porte toujours sur le montant. Un envoi de 100 000 XOF
  ne déclenche donc pas d'OTP malgré un débit réel de 101 000.
- `idempotency` fonctionne tel quel et met en cache la réponse enrichie.

C'est ce qui rend ce chantier peu risqué malgré son sujet sensible.

## Gestion d'erreurs

| Situation | Comportement |
|---|---|
| Montant tombant sur une borne de palier | Borne inclusive basse ; résolution déterministe. |
| Montant au-delà du dernier palier | Dernier palier, `max: Infinity`. |
| `computeFee` sur entrée invalide | Lève une erreur ; `sendMoney` valide déjà en amont. |
| Compte plateforme introuvable | Erreur explicite au démarrage plutôt qu'un transfert cassé en production ; capture Sentry. Jamais de transfert silencieusement amputé. |
| Échec en cours de transaction | `ROLLBACK` existant : les trois mouvements de solde et la ligne `transactions` sont atomiques. |

## Tests

Approche TDD (test rouge d'abord), comme sur le chantier OTP.

**Unitaires — `src/tests/fees.test.js`, sans base :**
- un cas par palier
- les bornes exactes (5 000 → 100, 5 001 → 250), là où se logent les erreurs de
  `<` au lieu de `<=`
- montant au-delà du dernier palier
- entrées invalides : négatif, `NaN`, non numérique

**Intégration — contre `paywest_test` :**
- transfert nominal : vérification des **trois** soldes et de la colonne `fee`
- **invariant Σ wallets constante** avant/après : attrape toute erreur de signe
  ou de montant, et prouve la promesse de cohérence comptable
- refus pour solde insuffisant causé par les seuls frais (solde 50 200, envoi
  50 000), avec vérification qu'aucun solde n'a bougé
- les deux routes `/api/fees`

**Non-régression :**
- un envoi de 100 000 XOF exactement ne déclenche pas d'OTP
- le plafond journalier s'impute de 100 000 et non de 101 000

Ces deux tests verrouillent les décisions de cadrage par du code plutôt que par
un commentaire.

**Tests existants à mettre à jour :** `transaction.test.js` affirme des soldes
après transfert qui ne tiennent plus une fois les frais prélevés. C'est le
comportement attendu et non un accident ; la mise à jour sera annoncée
explicitement, jamais faite en silence.

## Hors périmètre

- Frais sur retraits, dépôts et paiements marchands — gratuits par décision.
- Remboursement de frais : il n'existe aucune route d'annulation de transfert
  aujourd'hui.
- Décaissement des revenus plateforme via l'API : le solde s'accumule et se
  consulte ; le retrait se fera hors API dans un premier temps.
- Exonérations (promotion, premier transfert gratuit, tarif préférentiel) —
  ajoutables plus tard dans `computeFee` sans toucher aux contrôleurs.
- Grille tarifaire en base et route admin d'édition.

## Point préexistant signalé, non traité ici

Deux transferts croisés simultanés (A→B et B→A) peuvent se bloquer mutuellement,
les wallets étant verrouillés dans l'ordre expéditeur-puis-destinataire. Le
problème existe avant ce chantier ; ajouter le wallet plateforme en dernière
position ne l'aggrave pas. À traiter séparément si le besoin s'en fait sentir.
