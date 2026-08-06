const pool = require('../config/db');
const logger = require('../config/logger');

// Statistiques du marchand
const getMerchantStats = async (req, res) => {
  try {
    // Total des paiements reçus via QR
    const totalPayments = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE receiver_id = $1 AND type = 'payment' AND status = 'completed'`,
      [req.user.id]
    );

    // Paiements du jour
    const todayPayments = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE receiver_id = $1 AND type = 'payment' AND status = 'completed'
       AND created_at >= CURRENT_DATE`,
      [req.user.id]
    );

    // Paiements du mois
    const monthPayments = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE receiver_id = $1 AND type = 'payment' AND status = 'completed'
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [req.user.id]
    );

    // Solde actuel
    const wallet = await pool.query(
      'SELECT balance, currency FROM wallets WHERE user_id = $1',
      [req.user.id]
    );

    // 5 derniers paiements reçus
    const recentPayments = await pool.query(
      `SELECT t.*, u.full_name as sender_name, u.phone as sender_phone
       FROM transactions t
       JOIN users u ON t.sender_id = u.id
       WHERE t.receiver_id = $1 AND t.type = 'payment'
       ORDER BY t.created_at DESC LIMIT 5`,
      [req.user.id]
    );

    logger.info('Dashboard marchand consulté', { merchantId: req.user.id });

    res.json({
      wallet: wallet.rows[0],
      stats: {
        all_time: {
          count: parseInt(totalPayments.rows[0].count),
          total: parseFloat(totalPayments.rows[0].total)
        },
        today: {
          count: parseInt(todayPayments.rows[0].count),
          total: parseFloat(todayPayments.rows[0].total)
        },
        this_month: {
          count: parseInt(monthPayments.rows[0].count),
          total: parseFloat(monthPayments.rows[0].total)
        }
      },
      recent_payments: recentPayments.rows
    });

  } catch (error) {
    logger.error('Erreur dashboard marchand', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { getMerchantStats };