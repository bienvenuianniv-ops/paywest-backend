const pool = require('../config/db');

// Tous les utilisateurs
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at,
              w.balance, w.currency
       FROM users u
       JOIN wallets w ON u.id = w.user_id
       ORDER BY u.created_at DESC`
    );

    res.json(result.rows);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Toutes les transactions
const getAllTransactions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
              s.full_name as sender_name, s.phone as sender_phone,
              r.full_name as receiver_name, r.phone as receiver_phone
       FROM transactions t
       JOIN users s ON t.sender_id = s.id
       JOIN users r ON t.receiver_id = r.id
       ORDER BY t.created_at DESC`
    );

    res.json(result.rows);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Statistiques globales
const getStats = async (req, res) => {
  try {
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    const totalTransactions = await pool.query('SELECT COUNT(*) FROM transactions');
    const totalVolume = await pool.query(
      `SELECT SUM(amount) FROM transactions WHERE type = 'transfer' AND status = 'completed'`
    );
    const totalBalance = await pool.query('SELECT SUM(balance) FROM wallets');

    res.json({
      total_users: parseInt(totalUsers.rows[0].count),
      total_transactions: parseInt(totalTransactions.rows[0].count),
      total_volume: parseFloat(totalVolume.rows[0].sum) || 0,
      total_balance: parseFloat(totalBalance.rows[0].sum) || 0
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Changer le rôle d'un utilisateur
const updateUserRole = async (req, res) => {
  const { user_id, role } = req.body;

  try {
    const validRoles = ['customer', 'merchant', 'agent', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Rôle invalide' });
    }

    const result = await pool.query(
      `UPDATE users SET role = $1 WHERE id = $2
       RETURNING id, full_name, email, phone, role`,
      [role, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    res.json({ message: 'Rôle mis à jour avec succès', user: result.rows[0] });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getAllUsers, getAllTransactions, getStats, updateUserRole };