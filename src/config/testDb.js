const pool = require('./db');

async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Connexion Neon réussie :', result.rows[0].now);
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur de connexion :', error.message);
    process.exit(1);
  }
}

testConnection();