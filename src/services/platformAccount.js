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
