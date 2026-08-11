const pool = require('./db');

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'customer',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id),
        balance DECIMAL(15,2) DEFAULT 0.00,
        currency VARCHAR(10) DEFAULT 'XOF',
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id),
        receiver_id INTEGER REFERENCES users(id),
        amount DECIMAL(15,2) NOT NULL,
        type VARCHAR(20) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS merchant_qr_codes (
        id SERIAL PRIMARY KEY,
        merchant_id INTEGER REFERENCES users(id),
        qr_code VARCHAR(64) UNIQUE NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        key VARCHAR(255) NOT NULL,
        endpoint VARCHAR(100) NOT NULL,
        response_status INTEGER,
        response_body JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (user_id, key, endpoint)
      );

      CREATE TABLE IF NOT EXISTS otp_codes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        purpose VARCHAR(50) NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        binding_hash VARCHAR(64) NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_otp_codes_lookup
        ON otp_codes (user_id, purpose, binding_hash);

      CREATE TABLE IF NOT EXISTS otp_resend_cooldowns (
        user_id INTEGER NOT NULL,
        purpose VARCHAR(50) NOT NULL,
        binding_hash VARCHAR(64) NOT NULL,
        last_resend_at TIMESTAMP NOT NULL,
        PRIMARY KEY (user_id, purpose, binding_hash)
      );

      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee DECIMAL(15,2) NOT NULL DEFAULT 0;
    `);

    // Migration pour les bases créées avant l'ajout de la contrainte UNIQUE
    // sur wallets.user_id : CREATE TABLE IF NOT EXISTS ne la rajoute pas
    // rétroactivement sur une table déjà existante.
    const duplicates = await pool.query(
      `SELECT user_id FROM wallets WHERE user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1`
    );

    if (duplicates.rows.length > 0) {
      console.error(`⚠️ Doublons détectés sur wallets.user_id pour ${duplicates.rows.length} utilisateur(s) : contrainte UNIQUE non appliquée. Nettoyer les doublons manuellement avant de relancer initDb.`);
    } else {
      await pool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'wallets_user_id_key'
          ) THEN
            ALTER TABLE wallets ADD CONSTRAINT wallets_user_id_key UNIQUE (user_id);
          END IF;
        END $$;
      `);
    }

    // Compte plateforme : destinataire des frais de transfert.
    //
    // password '*' n'est pas un hash bcrypt valide, donc bcrypt.compare
    // renvoie toujours false : le compte n'est connectable par personne.
    // phone non numerique : le validateur (^\+?[0-9]{8,15}$) rejette cette
    // valeur a l'inscription comme en destinataire de transfert.
    //
    // Place APRES le bloc qui pose la contrainte UNIQUE sur wallets.user_id :
    // le ON CONFLICT (user_id) ci-dessous en depend.
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

    // Compte tresorerie : beneficiaire des decaissements (/api/admin/payout).
    //
    // Meme forme que le compte plateforme ci-dessus, et pour la meme raison :
    // password '*' n'est pas un hash bcrypt valide (personne ne s'y connecte),
    // telephone non numerique rejete par le validateur (personne ne lui envoie
    // d'argent). C'est ce qui fait de ce compte un cul-de-sac : les revenus y
    // entrent par le decaissement, et aucune route de l'API ne peut les en
    // sortir. Un jeton admin vole permet donc de declencher un decaissement,
    // mais pas d'en recuperer le produit.
    //
    // Le role est 'treasury' et surtout PAS 'platform' : platformAccount.js
    // resout le compte plateforme par `role = 'platform' ORDER BY id LIMIT 1`,
    // un second porteur de ce role en ferait un candidat departage par un
    // ORDER BY. 'treasury' n'est par ailleurs dans aucun verifyRole ni dans
    // les validRoles d'updateUserRole : le role n'est ni accordable ni
    // retirable par l'API.
    const treasuryInsert = await pool.query(`
      INSERT INTO users (full_name, email, phone, password, role)
      VALUES ('PayWest Trésorerie', 'treasury@paywest.internal', 'TREASURY-ACCOUNT', '*', 'treasury')
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `);

    const treasuryId = treasuryInsert.rows.length > 0
      ? treasuryInsert.rows[0].id
      : (await pool.query(
          `SELECT id FROM users WHERE email = 'treasury@paywest.internal'`
        )).rows[0].id;

    await pool.query(
      `INSERT INTO wallets (user_id, balance, currency)
       VALUES ($1, 0, 'XOF')
       ON CONFLICT (user_id) DO NOTHING`,
      [treasuryId]
    );

    console.log(`✅ Compte trésorerie prêt (user_id=${treasuryId})`);

    console.log('✅ Tables créées avec succès !');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur :', error.message);
    process.exit(1);
  }
}

initDb();