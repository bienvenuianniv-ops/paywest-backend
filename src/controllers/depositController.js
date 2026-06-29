const pool = require('../config/db');
const { sendEmail } = require('../config/mailer');

// Initier un dépôt Wave
const initiateWaveDeposit = async (req, res) => {
  const { amount, phone } = req.body;

  try {
    if (amount <= 0) {
      return res.status(400).json({ message: 'Montant invalide' });
    }

    // Générer une référence unique
    const reference = 'PAY-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

    // Enregistrer le dépôt en attente
    const transaction = await pool.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $1, $2, 'deposit', 'pending') RETURNING *`,
      [req.user.id, amount]
    );

    // Simuler le lien Wave (à remplacer par la vraie API Wave)
    const wavePaymentUrl = `https://pay.wave.com/m/paywest?amount=${amount}&ref=${reference}&phone=${phone}`;

    res.json({
      message: 'Dépôt initié avec succès',
      reference,
      transaction_id: transaction.rows[0].id,
      payment_url: wavePaymentUrl,
      amount,
      phone
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Webhook Wave — confirmer le dépôt
const confirmWaveDeposit = async (req, res) => {
  const { reference, transaction_id, status } = req.body;

  try {
    if (status !== 'completed') {
      return res.status(400).json({ message: 'Paiement non complété' });
    }

    // Récupérer la transaction
    const tx = await pool.query(
      'SELECT * FROM transactions WHERE id = $1',
      [transaction_id]
    );

    if (tx.rows.length === 0) {
      return res.status(404).json({ message: 'Transaction non trouvée' });
    }

    if (tx.rows[0].status === 'completed') {
      return res.status(400).json({ message: 'Transaction déjà complétée' });
    }

    // Créditer le wallet
    await pool.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [tx.rows[0].amount, tx.rows[0].sender_id]
    );

    // Mettre à jour le statut
    await pool.query(
      `UPDATE transactions SET status = 'completed' WHERE id = $1`,
      [transaction_id]
    );

    res.json({ message: 'Dépôt confirmé avec succès' });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Historique des dépôts
const getDeposits = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM transactions 
       WHERE sender_id = $1 AND type = 'deposit'
       ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { initiateWaveDeposit, confirmWaveDeposit, getDeposits };