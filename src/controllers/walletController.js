const pool = require('../config/db');

// Consulter son solde
const getWallet = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.balance, w.currency, w.updated_at, 
              u.full_name, u.phone, u.email
       FROM wallets w
       JOIN users u ON w.user_id = u.id
       WHERE w.user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Wallet non trouvé' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Erreur consultation wallet:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  }
};

// Recharger son wallet (admin/agent uniquement)
const creditWallet = async (req, res) => {
  const { user_id, amount: rawAmount } = req.body;
  const amount = Number(rawAmount);

  // Validation stricte : nombre fini et strictement positif
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  // Un seul client dédié : créditer le wallet et enregistrer la transaction
  // doit être tout ou rien.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE wallets
       SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [amount, user_id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Wallet non trouvé' });
    }

    // Enregistrer la transaction
    await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'credit', 'completed')`,
      [req.user.id, user_id, amount]
    );

    await client.query('COMMIT');

    res.json({ message: 'Wallet rechargé avec succès', wallet: result.rows[0] });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur recharge wallet:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
  }
};

module.exports = { getWallet, creditWallet };