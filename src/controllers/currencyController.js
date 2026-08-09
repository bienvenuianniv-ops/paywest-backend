const pool = require('../config/db');
const logger = require('../config/logger');

// Récupérer tous les taux de change
const getRates = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM exchange_rates ORDER BY from_currency, to_currency`
    );

    res.json(result.rows);

  } catch (error) {
    logger.error('Erreur récupération taux', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Convertir un montant
const convertAmount = async (req, res) => {
  const { from_currency, to_currency } = req.body;
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  if (from_currency === to_currency) {
    return res.json({
      from_currency,
      to_currency,
      amount,
      converted_amount: amount,
      fee: 0,
      fee_percent: 0,
      rate: 1
    });
  }

  try {
    const rateResult = await pool.query(
      `SELECT * FROM exchange_rates 
       WHERE from_currency = $1 AND to_currency = $2`,
      [from_currency, to_currency]
    );

    if (rateResult.rows.length === 0) {
      return res.status(404).json({ message: `Taux de change ${from_currency} → ${to_currency} non disponible` });
    }

    const rateData = rateResult.rows[0];
    const rate = parseFloat(rateData.rate);
    const feePercent = parseFloat(rateData.fee_percent);
    const fee = Math.round(amount * (feePercent / 100));
    const convertedAmount = Math.round((amount - fee) * rate * 100) / 100;

    logger.info('Conversion effectuée', { from_currency, to_currency, amount, convertedAmount });

    res.json({
      from_currency,
      to_currency,
      amount,
      converted_amount: convertedAmount,
      fee,
      fee_percent: feePercent,
      rate
    });

  } catch (error) {
    logger.error('Erreur conversion', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Mettre à jour un taux (admin uniquement)
const updateRate = async (req, res) => {
  const { from_currency, to_currency, rate, fee_percent } = req.body;

  try {
    const result = await pool.query(
      `UPDATE exchange_rates 
       SET rate = $1, fee_percent = $2, updated_at = NOW()
       WHERE from_currency = $3 AND to_currency = $4
       RETURNING *`,
      [rate, fee_percent, from_currency, to_currency]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Taux non trouvé' });
    }

    logger.info('Taux mis à jour', { from_currency, to_currency, rate, fee_percent, adminId: req.user.id });

    res.json({ message: 'Taux mis à jour avec succès', rate: result.rows[0] });

  } catch (error) {
    logger.error('Erreur mise à jour taux', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { getRates, convertAmount, updateRate };