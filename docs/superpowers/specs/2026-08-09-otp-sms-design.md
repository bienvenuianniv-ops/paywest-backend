# OTP SMS sur transferts/retraits — Design

## Contexte

PayWest applique déjà des plafonds réglementaires par transaction/jour/mois
(`transactionLimits.js`) et une protection anti-double-envoi optionnelle
(`idempotency.js`, header `Idempotency-Key`). Ces deux mécanismes protègent
contre le dépassement de plafond et le rejeu accidentel, mais pas contre le
vol d'un JWT valide : quiconque possède le token d'un utilisateur peut vider
son compte en une transaction, sans étape supplémentaire.

Ce design ajoute une vérification par code à usage unique envoyé par SMS,
déclenchée uniquement pour les opérations qui font sortir de l'argent
au-delà d'un certain montant.

## Portée

Déclenché sur :
- `POST /api/transactions/send`
- `POST /api/withdraw/wave`
- `POST /api/withdraw/orange`

Non couvert (décision explicite, hors scope) :
- Paiement marchand QR (`/api/merchant/pay`)
- Opérations agent (`/api/agent/credit`, `/api/agent/withdraw`)
- Actions de sécurité du compte (changement mot de passe/téléphone)

Seuil : **100 000 XOF fixe**, identique pour tous les rôles/statuts KYC. En
dessous, comportement strictement inchangé (aucun appel réseau OTP, aucune
latence ajoutée).

## Modèle de données

Nouvelle table `otp_codes` (DDL direct, hors migration versionnée — même
pratique que `idempotency_keys`) :

```sql
CREATE TABLE otp_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose VARCHAR(50) NOT NULL,       -- 'transactions.send' | 'withdraw.wave' | 'withdraw.orange'
  code_hash VARCHAR(255) NOT NULL,    -- bcrypt du code à 6 chiffres
  binding_hash VARCHAR(64) NOT NULL,  -- sha256(amount + destinataire), lie le code à CETTE transaction
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_otp_codes_lookup ON otp_codes (user_id, purpose, binding_hash);
```

`binding_hash` = `sha256(amount + ':' + receiver_phone)` pour
`transactions.send`, `sha256(amount + ':' + phone)` pour les retraits. Un
code demandé pour un montant/destinataire donné n'autorise que cette
combinaison exacte.

## Middleware `requireOtp(purpose)`

Inséré dans la chaîne existante, juste avant le contrôleur :

```
verifyToken → idempotency(label) → validate → checkTransactionLimits → requireOtp(purpose) → controller
```

Logique :

1. `amount <= 100000` → `next()` immédiat.
2. `amount > 100000` :
   - Calcule `binding_hash` à partir de `req.body`.
   - **Pas de `otp_code` dans le body** : invalide tout code actif existant
     pour ce `user_id + purpose + binding_hash` (au plus un code actif à la
     fois par binding), génère un nouveau code à 6 chiffres, l'enregistre
     (hashé, expiration `NOW() + 5 min`), envoie le SMS via un nouveau
     template `sendOtpSMS` dans `config/sms.js`, répond :
     `403 { otp_required: true, message: "Code envoyé par SMS, valable 5 minutes." }`.
   - **`otp_code` fourni** : cherche la ligne `user_id + purpose +
     binding_hash` non expirée, non utilisée, `attempts < 3`.
     - Introuvable / expirée / verrouillée (3 tentatives atteintes) :
       `401 { otp_invalid: true, message: "Code invalide ou expiré. Demandez un nouveau code." }`.
     - Trouvée mais code incorrect : incrémente `attempts`, même réponse 401.
     - Trouvée et code correct : marque `used_at = NOW()`, `next()`.

Aucune nouvelle route pour les 3 endpoints existants — seul le corps de
requête gagne un champ optionnel `otp_code`.

## Route utilitaire `POST /api/otp/resend`

Body : `{ purpose, amount, receiver_phone|phone }` (mêmes champs que la
transaction visée, pour recalculer le même `binding_hash`).

- `verifyToken`, `transactionLimiter` (déjà existant, réutilisé).
- Cooldown de 60s : vérifie `created_at` de la dernière ligne
  `otp_codes` pour `user_id + purpose` (pas de `express-rate-limit`, qui est
  par IP et ne correspond pas à la sémantique voulue) ; si < 60s, `429
  { message: "Veuillez patienter avant de redemander un code." }`.
- Sinon, même logique de génération/envoi que le middleware ci-dessus.

## Fix d'interaction avec `idempotency.js`

**Problème identifié** : la chaîne place `idempotency` avant `requireOtp`.
Si un client réutilise la même `Idempotency-Key` entre la tentative initiale
(sans code, réponse 403) et la resoumission (avec code), le middleware
`idempotency` actuel mettrait en cache cette réponse 403 et la renverrait
indéfiniment — la resoumission n'atteindrait jamais `requireOtp`, cassant
tout le flux OTP pour ce client.

**Fix** : dans `idempotency.js`, le wrapper de `res.json` ne persiste la
réponse en cache que si elle ne porte pas `otp_required: true` ni
`otp_invalid: true` — seule une issue finale (succès métier ou vraie erreur
métier comme solde insuffisant) doit être mise en cache. Un défi OTP n'est
pas une issue finale.

## Cas limites couverts

- Montant/destinataire modifié entre les deux appels → `binding_hash`
  différent → traité comme "aucun code fourni", nouveau défi OTP.
- Code correct réutilisé une 2e fois → `401` (`used_at` déjà posé).
- 3 codes faux consécutifs → verrouillé, passage obligé par `/otp/resend`.
- SMS non reçu → `/otp/resend` après cooldown, invalide l'ancien code au
  passage.

## Tests (Jest, contre `paywest_test`)

- Montant ≤ 100 000 → comportement inchangé, aucun OTP, aucune ligne
  `otp_codes` créée.
- Montant > 100 000 sans `otp_code` → `403 otp_required`, aucune
  transaction créée, ligne `otp_codes` créée.
- Resoumission avec le bon code → transaction exécutée, `used_at` posé.
- Réutilisation du même code → `401 otp_invalid`.
- 3 mauvais codes → verrouillé ; un 4e essai avec le bon code → toujours
  rejeté sans passer par `/otp/resend`.
- Changement de montant entre les deux appels → nouveau défi OTP, ancien
  code jamais accepté pour le nouveau montant.
- `/api/otp/resend` : rejeté avant cooldown (429), accepté après (nouveau
  code, ancien invalidé).
- Même `Idempotency-Key` sur la tentative initiale (403) et la resoumission
  (avec code) → la resoumission s'exécute réellement (vérifie le fix
  ci-dessus), pas de réponse 403 en cache.

Vérification fonctionnelle finale (comme pour l'idempotency key) contre la
vraie base `paywest_test`/Neon avant de considérer la fonctionnalité close,
avec nettoyage des données de test créées.
