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
    console.error('Erreur initiation dépôt Wave:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  }
};

// Webhook Wave — confirmer le dépôt
const confirmWaveDeposit = async (req, res) => {
  // Le webhook est un endpoint public (Wave n'a pas de JWT utilisateur) :
  // un secret partagé est la seule barrière avant de créditer un wallet.
  if (req.headers['x-webhook-secret'] !== process.env.WAVE_WEBHOOK_SECRET) {
    return res.status(401).json({ message: 'Non autorisé' });
  }

  const { reference, transaction_id, status } = req.body;

  if (status !== 'completed') {
    return res.status(400).json({ message: 'Paiement non complété' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verrouiller la ligne de transaction : un webhook rejoué en parallèle
    // doit attendre la fin de celui-ci avant de relire le statut, sinon
    // deux appels concurrents peuvent tous deux créditer le wallet.
    const tx = await client.query(
      'SELECT * FROM transactions WHERE id = $1 FOR UPDATE',
      [transaction_id]
    );

    if (tx.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Transaction non trouvée' });
    }

    if (tx.rows[0].status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Transaction déjà complétée' });
    }

    // Créditer le wallet
    await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [tx.rows[0].amount, tx.rows[0].sender_id]
    );

    // Mettre à jour le statut
    await client.query(
      `UPDATE transactions SET status = 'completed' WHERE id = $1`,
      [transaction_id]
    );

    await client.query('COMMIT');

    res.json({ message: 'Dépôt confirmé avec succès' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur confirmation dépôt Wave:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
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
    console.error('Erreur historique dépôts:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  }
};

module.exports = { initiateWaveDeposit, confirmWaveDeposit, getDeposits };