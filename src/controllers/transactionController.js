const pool = require('../config/db');
const { sendTransferNotification } = require('./notificationController');

// Envoyer de l'argent
const sendMoney = async (req, res) => {
  const { receiver_phone, amount } = req.body;

  try {
    // Vérifier que le montant est valide
    if (amount <= 0) {
      return res.status(400).json({ message: 'Montant invalide' });
    }

    // Trouver le destinataire par téléphone
    const receiverResult = await pool.query(
      'SELECT * FROM users WHERE phone = $1',
      [receiver_phone]
    );

    if (receiverResult.rows.length === 0) {
      return res.status(404).json({ message: 'Destinataire non trouvé' });
    }

    const receiver = receiverResult.rows[0];

    // Vérifier que l'envoyeur ne s'envoie pas à lui-même
    if (receiver.id === req.user.id) {
      return res.status(400).json({ message: 'Vous ne pouvez pas vous envoyer de l\'argent' });
    }

    // Vérifier le solde de l'envoyeur
    const senderWallet = await pool.query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [req.user.id]
    );

    if (parseFloat(senderWallet.rows[0].balance) < amount) {
      return res.status(400).json({ message: 'Solde insuffisant' });
    }

    // Débiter l'envoyeur
    await pool.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, req.user.id]
    );

    // Créditer le destinataire
    await pool.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, receiver.id]
    );

    // Enregistrer la transaction
    const transaction = await pool.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'transfer', 'completed') RETURNING *`,
      [req.user.id, receiver.id, amount]
    );

    // Envoyer notifications email
await sendTransferNotification(
  req.user.email || senderWallet.rows[0].email,
  receiver.full_name,
  receiver.email,
  receiver.full_name,
  amount
);
const senderInfo = await pool.query(
  'SELECT * FROM users WHERE id = $1', 
  [req.user.id]
);

await sendTransferNotification(
  senderInfo.rows[0].email,
  senderInfo.rows[0].full_name,
  receiverResult.rows[0].email,
receiverResult.rows[0].full_name,
  amount
);


await sendTransferNotification(
  senderInfo.rows[0].email,
  senderInfo.rows[0].full_name,
  receiver.email,
  receiver.full_name,
  amount
);

res.json({
  message: 'Transfert effectué avec succès',
  transaction: transaction.rows[0]
});

  } catch (error) {
    res.status(500).json({ message: error.message });
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