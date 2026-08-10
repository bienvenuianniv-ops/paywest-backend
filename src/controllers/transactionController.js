const pool = require('../config/db');
const { sendTransferNotification } = require('./notificationController');
const { sendTransferSMS } = require('../config/sms');
const logger = require('../config/logger');
const { phoneVariants } = require('../utils/phoneHelper');
const { computeFee } = require('../services/feeService');
const { getPlatformUserId } = require('../services/platformAccount');

// Envoyer de l'argent
const sendMoney = async (req, res) => {
  const { receiver_phone, amount: rawAmount } = req.body;
  const amount = Number(rawAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  // Les frais sont a la charge de l'expediteur, EN PLUS du montant : le
  // destinataire recoit exactement la somme saisie.
  const fee = computeFee(amount);
  const total = amount + fee;
  const platformUserId = await getPlatformUserId();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

const variants = phoneVariants(receiver_phone);
const placeholders = variants.map((_, i) => `$${i + 1}`).join(', ');
const receiverResult = await client.query(
  `SELECT * FROM users WHERE phone IN (${placeholders})`,
  variants
);

    if (receiverResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Destinataire non trouvé' });
    }

    const receiver = receiverResult.rows[0];

    if (receiver.id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Vous ne pouvez pas vous envoyer de l\'argent' });
    }

    const senderWallet = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (parseFloat(senderWallet.rows[0].balance) < total) {
      await client.query('ROLLBACK');
      logger.warn('Solde insuffisant', { userId: req.user.id, amount, fee, total });
      return res.status(400).json({
        message: `Solde insuffisant : ${total.toLocaleString('fr-FR')} XOF requis`,
        amount,
        fee,
        total_required: total,
        balance: parseFloat(senderWallet.rows[0].balance)
      });
    }

    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [total, req.user.id]
    );

    await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, receiver.id]
    );

    // Credit plateforme en DERNIER : cette ligne de wallet est touchee par
    // tous les transferts, son verrou serialise donc les transactions
    // concurrentes jusqu'au COMMIT. La placer ici reduit la duree de
    // detention au minimum.
    if (fee > 0) {
      await client.query(
        `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
         WHERE user_id = $2`,
        [fee, platformUserId]
      );
    }

    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status, fee)
       VALUES ($1, $2, $3, 'transfer', 'completed', $4) RETURNING *`,
      [req.user.id, receiver.id, amount, fee]
    );

    const senderInfo = await client.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user.id]
    );

    await client.query('COMMIT');

    logger.info('Transfert effectué', {
      senderId: req.user.id,
      receiverId: receiver.id,
      amount,
      fee,
      transactionId: transaction.rows[0].id
    });

    // Notifications email
    try {
      await sendTransferNotification(
        senderInfo.rows[0].email,
        senderInfo.rows[0].full_name,
        receiver.email,
        receiver.full_name,
        amount
      );
    } catch (mailError) {
      logger.error('Notification email transfert non envoyée', { error: mailError.message });
    }

    // Notifications SMS
    try {
      await sendTransferSMS(
        senderInfo.rows[0].phone,
        receiver.phone,
        senderInfo.rows[0].full_name,
        receiver.full_name,
        amount
      );
    } catch (smsError) {
      logger.error('Notification SMS transfert non envoyée', { error: smsError.message });
    }

    res.json({
      message: 'Transfert effectué avec succès',
      transaction: transaction.rows[0],
      fee,
      total_debit: total
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Erreur transfert', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
  }
};

// Historique des transactions avec pagination
const getTransactions = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const type = req.query.type || null;

    let whereClause = 'WHERE (t.sender_id = $1 OR t.receiver_id = $1)';
    const params = [req.user.id];

    if (type) {
      params.push(type);
      whereClause += ` AND t.type = $${params.length}`;
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
    logger.error('Erreur historique transactions', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  }
};

module.exports = { sendMoney, getTransactions };
