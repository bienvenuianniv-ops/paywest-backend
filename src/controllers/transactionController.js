const pool = require('../config/db');
const { sendTransferNotification } = require('./notificationController');

// Envoyer de l'argent
const sendMoney = async (req, res) => {
  const { receiver_phone, amount: rawAmount } = req.body;
  const amount = Number(rawAmount);

  // Validation stricte : nombre fini et strictement positif
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  // Un seul client dédié pour toute la durée de la transaction SQL
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Trouver le destinataire par téléphone
    const receiverResult = await client.query(
      'SELECT * FROM users WHERE phone = $1',
      [receiver_phone]
    );

    if (receiverResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Destinataire non trouvé' });
    }

    const receiver = receiverResult.rows[0];

    // Vérifier que l'envoyeur ne s'envoie pas à lui-même
    if (receiver.id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Vous ne pouvez pas vous envoyer de l\'argent' });
    }

    // Verrouiller la ligne du wallet envoyeur : un transfert concurrent sur ce
    // même compte doit attendre la fin de celui-ci avant de lire le solde.
    const senderWallet = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (parseFloat(senderWallet.rows[0].balance) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solde insuffisant' });
    }

    // Débiter l'envoyeur
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, req.user.id]
    );

    // Créditer le destinataire
    await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, receiver.id]
    );

    // Enregistrer la transaction
    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'transfer', 'completed') RETURNING *`,
      [req.user.id, receiver.id, amount]
    );

    // Infos envoyeur pour la notification (avant le COMMIT, même client)
    const senderInfo = await client.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user.id]
    );

    await client.query('COMMIT');

    // La notification part APRES le commit : un email qui échoue ne doit
    // jamais faire annuler un transfert d'argent déjà validé.
    try {
      await sendTransferNotification(
        senderInfo.rows[0].email,
        senderInfo.rows[0].full_name,
        receiver.email,
        receiver.full_name,
        amount
      );
    } catch (mailError) {
      console.error('Notification transfert non envoyée:', mailError.message);
    }

    res.json({
      message: 'Transfert effectué avec succès',
      transaction: transaction.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: error.message });
  } finally {
    client.release();
  }
};

// Historique des transactions
const getTransactions = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, 
              s.full_name as sender_name, s.phone as sender_phone,
              r.full_name as receiver_name, r.phone as receiver_phone
       FROM transactions t
       JOIN users s ON t.sender_id = s.id
       JOIN users r ON t.receiver_id = r.id
       WHERE t.sender_id = $1 OR t.receiver_id = $1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { sendMoney, getTransactions };