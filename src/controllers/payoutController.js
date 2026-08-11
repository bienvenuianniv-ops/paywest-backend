const pool = require('../config/db');
const logger = require('../config/logger');
const { getPlatformUserId } = require('../services/platformAccount');

const getPlatformBalance = async (req, res) => {
  try {
    const platformUserId = await getPlatformUserId();

    const result = await pool.query(
      'SELECT balance, currency FROM wallets WHERE user_id = $1',
      [platformUserId]
    );

    if (result.rows.length === 0) {
      logger.error('Wallet plateforme introuvable', { platformUserId });
      return res.status(500).json({ message: 'Compte plateforme non configuré' });
    }

    res.json({
      platform_user_id: platformUserId,
      balance: parseFloat(result.rows[0].balance),
      currency: result.rows[0].currency
    });

  } catch (error) {
    logger.error('Erreur consultation solde plateforme', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { getPlatformBalance };
