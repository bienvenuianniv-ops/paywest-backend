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
