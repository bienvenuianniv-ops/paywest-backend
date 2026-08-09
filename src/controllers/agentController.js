const pool = require('../config/db');
const logger = require('../config/logger');
const { phoneVariants } = require('../utils/phoneHelper');

// Recharger le wallet d'un client
const creditClient = async (req, res) => {
  const { client_phone } = req.body;
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Trouver le client par téléphone
   const variants = phoneVariants(client_phone);
const clientUser = await client.query(
  'SELECT * FROM users WHERE phone = ANY($1)',
  [variants]
);

    if (clientUser.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Client non trouvé' });
    }

    const targetUser = clientUser.rows[0];

    // Vérifier que l'agent ne se recharge pas lui-même
    if (targetUser.id === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Vous ne pouvez pas vous recharger vous-même' });
    }

    // Créditer le wallet du client
    await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, targetUser.id]
    );

    // Enregistrer la transaction
    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'credit', 'completed') RETURNING *`,
      [req.user.id, targetUser.id, amount]
    );

    await client.query('COMMIT');

    logger.info('Agent - recharge client', {
      agentId: req.user.id,
      clientId: targetUser.id,
      amount
    });

    res.json({
      message: `Wallet de ${targetUser.full_name} rechargé avec succès`,
      transaction: transaction.rows[0],
      client: {
        full_name: targetUser.full_name,
        phone: targetUser.phone
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Erreur recharge agent', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// Retrait pour un client
const withdrawClient = async (req, res) => {
  const { client_phone } = req.body;
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

   // Trouver le client
    const variants = phoneVariants(client_phone);
    const clientUser = await client.query(
      'SELECT * FROM users WHERE phone = ANY($1)',
      [variants]
    );

    if (clientUser.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Client non trouvé' });
    }

    const targetUser = clientUser.rows[0];

    // Vérifier le solde du client
    const clientWallet = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [targetUser.id]
    );

    if (clientWallet.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Portefeuille client introuvable' });
    }

    if (parseFloat(clientWallet.rows[0].balance) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solde client insuffisant' });
    }

    // Débiter le wallet du client
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, targetUser.id]
    );

    // Enregistrer la transaction
    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'withdraw', 'completed') RETURNING *`,
      [targetUser.id, req.user.id, amount]
    );

    await client.query('COMMIT');

    logger.info('Agent - retrait client', {
      agentId: req.user.id,
      clientId: targetUser.id,
      amount
    });

    res.json({
      message: `Retrait de ${amount} XOF effectué pour ${targetUser.full_name}`,
      transaction: transaction.rows[0],
      client: {
        full_name: targetUser.full_name,
        phone: targetUser.phone
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Erreur retrait agent', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// Historique des opérations de l'agent
const getAgentHistory = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
              u.full_name as client_name, u.phone as client_phone
       FROM transactions t
       JOIN users u ON (
         CASE WHEN t.type = 'credit' THEN t.receiver_id
              ELSE t.sender_id END = u.id
       )
       WHERE (t.sender_id = $1 OR t.receiver_id = $1)
       AND t.type IN ('credit', 'withdraw')
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);

  } catch (error) {
    logger.error('Erreur historique agent', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { creditClient, withdrawClient, getAgentHistory };