const pool = require('../config/db');
const logger = require('../config/logger');

// Tous les utilisateurs avec pagination
const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at,
              w.balance, w.currency
       FROM users u
       JOIN wallets w ON u.id = w.user_id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: totalPages, has_next: page < totalPages, has_prev: page > 1 }
    });

  } catch (error) {
    logger.error('Erreur liste utilisateurs', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Toutes les transactions avec pagination
const getAllTransactions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const type = req.query.type || null;
    const status = req.query.status || null;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (type) {
      params.push(type);
      whereClause += ` AND t.type = $${params.length}`;
    }

    if (status) {
      params.push(status);
      whereClause += ` AND t.status = $${params.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM transactions t ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT t.*,
              s.full_name as sender_name, s.phone as sender_phone,
              r.full_name as receiver_name, r.phone as receiver_phone
       FROM transactions t
       JOIN users s ON t.sender_id = s.id
       JOIN users r ON t.receiver_id = r.id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      data: result.rows,
      pagination: { page, limit, total, total_pages: totalPages, has_next: page < totalPages, has_prev: page > 1 }
    });

  } catch (error) {
    logger.error('Erreur liste transactions admin', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Statistiques globales avancées
const getStats = async (req, res) => {
  try {
    // Stats générales
    const totalUsers = await pool.query('SELECT COUNT(*) FROM users');
    const totalTransactions = await pool.query('SELECT COUNT(*) FROM transactions');
    const totalVolume = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'transfer' AND status = 'completed'`
    );
    const totalBalance = await pool.query('SELECT COALESCE(SUM(balance), 0) FROM wallets');

    // Stats par rôle
    const usersByRole = await pool.query(
      `SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC`
    );

    // Stats par type de transaction
    const txByType = await pool.query(
      `SELECT type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM transactions WHERE status = 'completed'
       GROUP BY type ORDER BY total DESC`
    );

    // Volume des 7 derniers jours
    const weeklyVolume = await pool.query(
      `SELECT DATE(created_at) as date, 
              COUNT(*) as count,
              COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE created_at >= NOW() - INTERVAL '7 days'
       AND status = 'completed'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    // Volume du mois en cours
    const monthlyVolume = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
       FROM transactions
       WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
       AND status = 'completed'`
    );

    // Nouveaux utilisateurs cette semaine
    const newUsersWeek = await pool.query(
      `SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`
    );

    // Top 5 utilisateurs par volume
    const topUsers = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.role, w.balance,
              COUNT(t.id) as tx_count,
              COALESCE(SUM(t.amount), 0) as tx_volume
       FROM users u
       JOIN wallets w ON u.id = w.user_id
       LEFT JOIN transactions t ON t.sender_id = u.id AND t.status = 'completed'
       GROUP BY u.id, u.full_name, u.email, u.role, w.balance
       ORDER BY tx_volume DESC
       LIMIT 5`
    );

    logger.info('Stats admin consultées', { adminId: req.user.id });

    res.json({
      overview: {
        total_users: parseInt(totalUsers.rows[0].count),
        total_transactions: parseInt(totalTransactions.rows[0].count),
        total_volume: parseFloat(totalVolume.rows[0].coalesce) || 0,
        total_balance: parseFloat(totalBalance.rows[0].coalesce) || 0,
        new_users_this_week: parseInt(newUsersWeek.rows[0].count),
        monthly_volume: parseFloat(monthlyVolume.rows[0].total) || 0,
        monthly_tx_count: parseInt(monthlyVolume.rows[0].count)
      },
      users_by_role: usersByRole.rows,
      transactions_by_type: txByType.rows,
      weekly_volume: weeklyVolume.rows,
      top_users: topUsers.rows
    });

  } catch (error) {
    logger.error('Erreur statistiques admin', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
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

    logger.info('Rôle utilisateur modifié', { adminId: req.user.id, userId: user_id, newRole: role });

    res.json({ message: 'Rôle mis à jour avec succès', user: result.rows[0] });

  } catch (error) {
    logger.error('Erreur changement de rôle', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Suspendre un utilisateur
const suspendUser = async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE users SET role = 'suspended' WHERE id = $1
       RETURNING id, full_name, email, role`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    logger.info('Utilisateur suspendu', { adminId: req.user.id, userId: user_id });

    res.json({ message: 'Utilisateur suspendu avec succès', user: result.rows[0] });

  } catch (error) {
    logger.error('Erreur suspension utilisateur', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { getAllUsers, getAllTransactions, getStats, updateUserRole, suspendUser };
