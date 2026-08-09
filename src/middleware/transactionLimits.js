const pool = require('../config/db');
const logger = require('../config/logger');

// Limites par rôle (en XOF)
const LIMITS = {
  customer: {
    per_transaction: 150000,
    per_day: 300000,
    per_month: 1000000,
    per_transaction_kyc: 1000000,
    per_day_kyc: 3000000,
    per_month_kyc: 5000000
  },
  merchant: {
    per_transaction: 5000000,
    per_day: 20000000,
    per_month: 100000000
  },
  agent: {
    per_transaction: 2000000,
    per_day: 10000000,
    per_month: 50000000
  },
  admin: {
    per_transaction: Infinity,
    per_day: Infinity,
    per_month: Infinity
  }
};

const checkTransactionLimits = async (req, res, next) => {
  const amount = Number(req.body.amount);
  const userId = req.user.id;
  const role = req.user.role;

  try {
    // Récupérer les infos de l'utilisateur
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    const user = userResult.rows[0];
    const limits = LIMITS[role] || LIMITS.customer;
    const isKYCVerified = user.kyc_verified || false;

    // Choisir les limites selon KYC
    const maxPerTx = isKYCVerified && role === 'customer'
      ? limits.per_transaction_kyc
      : limits.per_transaction;

    const maxPerDay = isKYCVerified && role === 'customer'
      ? limits.per_day_kyc
      : limits.per_day;

    const maxPerMonth = isKYCVerified && role === 'customer'
      ? limits.per_month_kyc
      : limits.per_month;

    // Vérifier la limite par transaction
    if (amount > maxPerTx) {
      logger.warn('Limite par transaction dépassée', { userId, amount, maxPerTx });
      return res.status(400).json({
        message: `Montant maximum par transaction : ${maxPerTx.toLocaleString('fr-FR')} XOF`,
        limit: maxPerTx,
        kyc_required: !isKYCVerified && role === 'customer'
      });
    }

    // Vérifier la limite journalière
    const dailyResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE sender_id = $1
       AND type IN ('transfer', 'withdraw')
       AND status = 'completed'
       AND created_at >= CURRENT_DATE`,
      [userId]
    );

    const dailyTotal = parseFloat(dailyResult.rows[0].total) + amount;

    if (dailyTotal > maxPerDay) {
      logger.warn('Limite journalière dépassée', { userId, dailyTotal, maxPerDay });
      return res.status(400).json({
        message: `Plafond journalier atteint : ${maxPerDay.toLocaleString('fr-FR')} XOF`,
        limit: maxPerDay,
        current: parseFloat(dailyResult.rows[0].total),
        kyc_required: !isKYCVerified && role === 'customer'
      });
    }

    // Vérifier la limite mensuelle
    const monthlyResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE sender_id = $1
       AND type IN ('transfer', 'withdraw')
       AND status = 'completed'
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [userId]
    );

    const monthlyTotal = parseFloat(monthlyResult.rows[0].total) + amount;

    if (monthlyTotal > maxPerMonth) {
      logger.warn('Limite mensuelle dépassée', { userId, monthlyTotal, maxPerMonth });
      return res.status(400).json({
        message: `Plafond mensuel atteint : ${maxPerMonth.toLocaleString('fr-FR')} XOF`,
        limit: maxPerMonth,
        current: parseFloat(monthlyResult.rows[0].total),
        kyc_required: !isKYCVerified && role === 'customer'
      });
    }

    logger.info('Limites vérifiées', { userId, role, amount, isKYCVerified });
    next();

  } catch (error) {
    logger.error('Erreur vérification limites', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { checkTransactionLimits, LIMITS };