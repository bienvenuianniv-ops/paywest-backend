const pool = require('../config/db');
const crypto = require('crypto');

// Générer un QR code pour le marchand (statique, réutilisable)
// Génère un nouveau code et désactive automatiquement l'ancien —
// c'est ce qui permet au marchand de révoquer un QR compromis
// simplement en en régénérant un nouveau.
const generateQRCode = async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const user = await client.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user.id]
    );

    if (user.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Désactiver l'ancien code actif de ce marchand, s'il existe
    await client.query(
      `UPDATE merchant_qr_codes SET status = 'revoked'
       WHERE merchant_id = $1 AND status = 'active'`,
      [req.user.id]
    );

    // Générer et enregistrer le nouveau code
    const qrCode = crypto.randomBytes(16).toString('hex');
    await client.query(
      `INSERT INTO merchant_qr_codes (merchant_id, qr_code, status)
       VALUES ($1, $2, 'active')`,
      [req.user.id, qrCode]
    );

    await client.query('COMMIT');

    const qrData = {
      merchant_id: req.user.id,
      merchant_name: user.rows[0].full_name,
      phone: user.rows[0].phone,
      qr_code: qrCode,
      generated_at: new Date().toISOString()
    };

    res.json({
      message: 'QR code généré avec succès. Le précédent QR de ce compte est désormais invalide.',
      qr_data: qrData,
      payment_url: `https://paywest.mayouservice.com/pay?merchant=${req.user.id}&code=${qrCode}`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur génération QR code:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
  }
};

// Payer via QR code
const payViaQR = async (req, res) => {
  const { merchant_id, qr_code, amount: rawAmount } = req.body;
  const amount = Number(rawAmount);

  // Validation stricte : nombre fini et strictement positif
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  if (!qr_code) {
    return res.status(400).json({ message: 'QR code manquant' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Vérifier que le marchand existe
    const merchant = await client.query(
      'SELECT * FROM users WHERE id = $1',
      [merchant_id]
    );

    if (merchant.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Marchand non trouvé' });
    }

    // Vérifier que le QR code envoyé correspond bien à un code ACTIF
    // appartenant à CE marchand précis. C'est ça qui empêche de payer
    // en devinant juste un merchant_id, sans jamais avoir scanné de vrai QR.
    const qrRecord = await client.query(
      `SELECT * FROM merchant_qr_codes
       WHERE qr_code = $1 AND merchant_id = $2 AND status = 'active'`,
      [qr_code, merchant_id]
    );

    if (qrRecord.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'QR code invalide ou expiré' });
    }

    // Vérifier que le client ne paie pas lui-même
    if (parseInt(merchant_id) === req.user.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Vous ne pouvez pas vous payer vous-même' });
    }

    // Verrouiller la ligne du wallet client : un paiement concurrent sur ce
    // même compte doit attendre la fin de celui-ci avant de lire le solde.
    const clientWallet = await client.query(
      'SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE',
      [req.user.id]
    );

    if (parseFloat(clientWallet.rows[0].balance) < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Solde insuffisant' });
    }

    // Débiter le client
    await client.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, req.user.id]
    );

    // Créditer le marchand
    await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, merchant_id]
    );

    // Enregistrer la transaction
    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'payment', 'completed') RETURNING *`,
      [req.user.id, merchant_id, amount]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Paiement effectué avec succès',
      transaction: transaction.rows[0],
      merchant_name: merchant.rows[0].full_name
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur paiement QR code:', error.message);
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
  }
};

module.exports = { generateQRCode, payViaQR };