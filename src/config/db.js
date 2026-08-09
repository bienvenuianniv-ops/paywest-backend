const { Pool } = require('pg');
require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test';

if (isTest && !process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL manquant — les tests ne doivent jamais utiliser DATABASE_URL (production)');
}

const pool = new Pool({
  connectionString: isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: true
  }
});

module.exports = pool;