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
    res.status(500).json({ message: error.message });
  }
};

// Recharger son wallet (admin/agent uniquement)
const creditWallet = async (req, res) => {
  const { user_id, amount } = req.body;

  try {
    const result = await pool.query(
      `UPDATE wallets 
       SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [amount, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Wallet non trouvé' });
    }

    // Enregistrer la transaction
    await pool.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'credit', 'completed')`,
      [req.user.id, user_id, amount]
    );

    res.json({ message: 'Wallet rechargé avec succès', wallet: result.rows[0] });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getWallet, creditWallet };