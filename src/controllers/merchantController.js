const pool = require('../config/db');
const crypto = require('crypto');

// Générer un QR code pour le marchand
const generateQRCode = async (req, res) => {
  try {
    // Vérifier que l'utilisateur est bien marchand ou admin
    const user = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [req.user.id]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé' });
    }

    // Générer un code unique pour le marchand
    const qrCode = crypto.randomBytes(16).toString('hex');
    const qrData = {
      merchant_id: req.user.id,
      merchant_name: user.rows[0].full_name,
      phone: user.rows[0].phone,
      qr_code: qrCode,
      generated_at: new Date().toISOString()
    };

    res.json({
      message: 'QR code généré avec succès',
      qr_data: qrData,
      payment_url: `https://paywest.mayouservice.com/pay?merchant=${req.user.id}&code=${qrCode}`
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Payer via QR code
const payViaQR = async (req, res) => {
  const { merchant_id, qr_code, amount } = req.body;

  try {
    // Vérifier que le montant est valide
    if (amount <= 0) {
      return res.status(400).json({ message: 'Montant invalide' });
    }

    // Vérifier que le marchand existe
    const merchant = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [merchant_id]
    );

    if (merchant.rows.length === 0) {
      return res.status(404).json({ message: 'Marchand non trouvé' });
    }

    // Vérifier que le client ne paie pas lui-même
    if (parseInt(merchant_id) === req.user.id) {
      return res.status(400).json({ message: 'Vous ne pouvez pas vous payer vous-même' });
    }

    // Vérifier le solde du client
    const clientWallet = await pool.query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [req.user.id]
    );

    if (parseFloat(clientWallet.rows[0].balance) < amount) {
      return res.status(400).json({ message: 'Solde insuffisant' });
    }

    // Débiter le client
    await pool.query(
      `UPDATE wallets SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, req.user.id]
    );

    // Créditer le marchand
    await pool.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2`,
      [amount, merchant_id]
    );

    // Enregistrer la transaction
    const transaction = await pool.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'payment', 'completed') RETURNING *`,
      [req.user.id, merchant_id, amount]
    );

    res.json({
      message: 'Paiement effectué avec succès',
      transaction: transaction.rows[0],
      merchant_name: merchant.rows[0].full_name
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { generateQRCode, payViaQR };