# Analyse des bugs — Paiement QR (`payViaQR`)

Fichier concerné : `src/controllers/merchantController.js`
Route : `POST /api/merchant/pay`

## Bug 1 — `merchant_id` non validé avant utilisation

**Localisation** : `merchantController.js`, début de `payViaQR` (lecture du body) et première requête SQL (`SELECT * FROM users WHERE id = $1`, paramètre `merchant_id`).

**Constat** : `amount` est strictement validé (`Number.isFinite(amount) && amount > 0`) avant tout accès base de données. `qr_code` est vérifié en présence (`if (!qr_code)`). `merchant_id`, lui, est utilisé brut, sans aucune validation :
- pas de vérification de présence (`undefined` accepté silencieusement),
- pas de vérification de type/format (une chaîne non numérique comme `"abc"` est envoyée telle quelle au driver pg).

Plus loin dans la fonction, `parseInt(merchant_id) === req.user.id` est utilisé pour la comparaison anti-self-payment — ce qui confirme que le code s'attend bien à ce que `merchant_id` soit numérique, sans jamais l'avoir garanti en amont.

**Conséquence** : comportement incohérent selon la valeur reçue :
- `merchant_id` absent → la requête part avec `undefined`, résultat imprévisible selon le driver (peut lever une exception non contrôlée plutôt qu'un 400 propre).
- `merchant_id` non numérique → même souci, en plus du `parseInt()` plus loin qui renverrait `NaN` (une comparaison `NaN === req.user.id` est toujours `false`, donc la protection anti-auto-paiement serait silencieusement contournée dans ce cas précis si le reste de la logique laissait passer une valeur non numérique jusque-là).

**Sévérité** : moyenne — pas de faille de sécurité exploitable en soi (le `SELECT` suivant filtrera dans la plupart des cas), mais incohérence de robustesse et risque de 500 non explicite au lieu d'un 400 clair.

**Garde-fou proposé** :
```js
const merchantId = parseInt(merchant_id, 10);
if (!Number.isInteger(merchantId)) {
  return res.status(400).json({ message: 'Identifiant marchand invalide' });
}
```
À placer juste après la validation de `amount`, et réutiliser `merchantId` (au lieu de `merchant_id` brut) dans toutes les requêtes SQL et comparaisons qui suivent.

---

## Bug 2 — Crash silencieux si le wallet du payeur est introuvable

**Localisation** : `merchantController.js`, ligne du `SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE` suivie de `parseFloat(clientWallet.rows[0].balance)`.

**Constat** : si `clientWallet.rows.length === 0` (aucun wallet pour `req.user.id`), `clientWallet.rows[0]` vaut `undefined`. L'accès à `.balance` lève alors un `TypeError` non anticipé.

**Conséquence** : l'erreur est rattrapée par le `catch` global de la fonction, qui fait un `ROLLBACK` et renvoie un `500 { message: 'Erreur serveur, veuillez réessayer plus tard' }`. Le comportement HTTP reste donc correct (pas de crash serveur, pas de fuite d'info), **mais la cause réelle (wallet manquant) est masquée** derrière un message générique — ça complique le diagnostic si ce cas se présente un jour (incohérence de données, migration ratée, compte créé hors du flux `register` normal).

**Sévérité** : faible en conditions normales, car `authController.js` crée toujours un wallet en même temps que le compte (transaction atomique `BEGIN`/`COMMIT` à l'inscription). Ce cas ne devrait donc se produire qu'en cas de données incohérentes en base — mais rien dans le code ne le garantit explicitement à cet endroit, ni ne le distingue d'une vraie erreur serveur.

**Garde-fou proposé** :
```js
if (clientWallet.rows.length === 0) {
  await client.query('ROLLBACK');
  console.error(`Wallet introuvable pour l'utilisateur ${req.user.id} lors d'un paiement QR`);
  return res.status(404).json({ message: 'Portefeuille introuvable' });
}
```
À insérer juste après le `SELECT ... FOR UPDATE`, avant la lecture de `.balance`. Le `console.error` explicite permet de repérer immédiatement en log qu'il s'agit d'une incohérence de données (wallet manquant) et non d'une erreur SQL générique.

---

## Résumé

| # | Bug | Sévérité | Statut |
|---|-----|----------|--------|
| 1 | `merchant_id` non validé (type/présence) avant requête SQL et comparaison | Moyenne | Corrigé |
| 2 | Accès `.balance` sur wallet potentiellement absent → crash masqué en 500 générique | Faible | Corrigé |

Aucun champ requis par le contrôleur (`merchant_id`, `qr_code`, `amount`) n'est structurellement absent de la route ou du body attendu — les deux points ci-dessus sont des manques de validation/garde-fou, pas des champs manquants dans le schéma de la requête.
