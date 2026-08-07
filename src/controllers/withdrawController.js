const pool = require('../config/db');
const logger = require('../config/logger');

// Initier un retrait vers Wave
const withdrawToWave = async (req, res) => {
  const { amount, phone } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Vérifier le solde
    const wallet = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (parseFloat(wallet.rows[0].balance) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solde insuffisant' });
    }

    // Générer une référence unique
    const reference = 'WDR-WAVE-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

    // Débiter le wallet
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, req.user.id]
    );

    // Enregistrer la transaction
    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $1, $2, 'withdraw', 'pending') RETURNING *`,
      [req.user.id, amount]
    );

    await client.query('COMMIT');

    logger.info('Retrait Wave initié', {
      userId: req.user.id,
      amount,
      phone,
      reference
    });

    // Simuler l'envoi vers Wave (à remplacer par la vraie API Wave)
    const wavePayoutUrl = `https://api.wave.com/v1/payout?amount=${amount}&phone=${phone}&ref=${reference}`;

    res.json({
      message: 'Retrait Wave initié avec succès',
      reference,
      transaction_id: transaction.rows[0].id,
      amount,
      phone,
      payout_url: wavePayoutUrl,
      status: 'pending'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Erreur retrait Wave', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// Initier un retrait vers Orange Money
const withdrawToOrange = async (req, res) => {
  const { amount, phone } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Vérifier le solde
    const wallet = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (parseFloat(wallet.rows[0].balance) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solde insuffisant' });
    }

    // Générer une référence unique
    const reference = 'WDR-OM-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

    // Débiter le wallet
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, req.user.id]
    );

    // Enregistrer la transaction
    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $1, $2, 'withdraw', 'pending') RETURNING *`,
      [req.user.id, amount]
    );

    await client.query('COMMIT');

    logger.info('Retrait Orange Money initié', {
      userId: req.user.id,
      amount,
      phone,
      reference
    });

    // Simuler l'envoi vers Orange Money (à remplacer par la vraie API Orange)
    const orangePayoutUrl = `https://api.orange.com/orange-money-webpay/v1/payout?amount=${amount}&phone=${phone}&ref=${reference}`;

    res.json({
      message: 'Retrait Orange Money initié avec succès',
      reference,
      transaction_id: transaction.rows[0].id,
      amount,
      phone,
      payout_url: orangePayoutUrl,
      status: 'pending'
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Erreur retrait Orange Money', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// Confirmer un retrait via webhook
const confirmWithdraw = async (req, res) => {
  const { reference, transaction_id, status } = req.body;

  try {
    const newStatus = status === 'completed' ? 'completed' : 'failed';

    // Si le retrait a échoué, rembourser le wallet
    if (newStatus === 'failed') {
      const tx = await pool.query(
        'SELECT * FROM transactions WHERE id = $1',
        [transaction_id]
      );

      if (tx.rows.length > 0) {
        await pool.query(
          `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
           WHERE user_id = $2`,
          [tx.rows[0].amount, tx.rows[0].sender_id]
        );
      }
    }

    // Mettre à jour le statut
    await pool.query(
      'UPDATE transactions SET status = $1 WHERE id = $2',
      [newStatus, transaction_id]
    );

    logger.info('Retrait confirmé', { reference, transaction_id, status: newStatus });

    res.json({ message: `Retrait ${newStatus === 'completed' ? 'confirmé' : 'échoué et remboursé'}` });

  } catch (error) {
    logger.error('Erreur confirmation retrait', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Historique des retraits
const getWithdrawals = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM transactions WHERE sender_id = $1 AND type = $2',
      [req.user.id, 'withdraw']
    );
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const result = await pool.query(
      `SELECT * FROM transactions
       WHERE sender_id = $1 AND type = 'withdraw'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1
      }
    });

  } catch (error) {
    logger.error('Erreur historique retraits', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { withdrawToWave, withdrawToOrange, confirmWithdraw, getWithdrawals };