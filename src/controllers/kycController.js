const pool = require('../config/db');
const logger = require('../config/logger');

// Soumettre une demande KYC
const submitKYC = async (req, res) => {
  const { document_type, document_number, full_name, date_of_birth, nationality } = req.body;

  try {
    // Vérifier si un KYC existe déjà
    const existing = await pool.query(
      'SELECT * FROM kyc_requests WHERE user_id = $1',
      [req.user.id]
    );

    if (existing.rows.length > 0) {
      const status = existing.rows[0].status;
      if (status === 'approved') {
        return res.status(400).json({ message: 'Votre identité est déjà vérifiée' });
      }
      if (status === 'pending') {
        return res.status(400).json({ message: 'Votre demande KYC est en cours de traitement' });
      }
    }

    // Créer la demande KYC
    const result = await pool.query(
      `INSERT INTO kyc_requests (user_id, document_type, document_number, full_name, date_of_birth, nationality, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING *`,
      [req.user.id, document_type, document_number, full_name, date_of_birth, nationality]
    );

    logger.info('Demande KYC soumise', { userId: req.user.id, document_type });

    res.status(201).json({
      message: 'Demande KYC soumise avec succès — en cours de vérification',
      kyc: result.rows[0]
    });

  } catch (error) {
    logger.error('Erreur soumission KYC', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Consulter son statut KYC
const getKYCStatus = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM kyc_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json({ status: 'not_submitted', message: 'Aucune demande KYC soumise' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    logger.error('Erreur statut KYC', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Approuver ou rejeter un KYC (admin uniquement)
const reviewKYC = async (req, res) => {
  const { kyc_id, status, rejection_reason } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Statut invalide — approved ou rejected' });
  }

  try {
    const result = await pool.query(
      `UPDATE kyc_requests 
       SET status = $1, rejection_reason = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4 RETURNING *`,
      [status, rejection_reason || null, req.user.id, kyc_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Demande KYC non trouvée' });
    }

    // Si approuvé, mettre à jour le rôle de l'utilisateur
    if (status === 'approved') {
      await pool.query(
        `UPDATE users SET kyc_verified = true WHERE id = $1`,
        [result.rows[0].user_id]
      );
    }

    logger.info('KYC examiné', { adminId: req.user.id, kyc_id, status });

    res.json({
      message: `KYC ${status === 'approved' ? 'approuvé' : 'rejeté'} avec succès`,
      kyc: result.rows[0]
    });

  } catch (error) {
    logger.error('Erreur examen KYC', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Liste toutes les demandes KYC (admin uniquement)
const getAllKYC = async (req, res) => {
  try {
    const status = req.query.status || null;
    let query = `SELECT k.*, u.email, u.phone, u.full_name as user_name
                 FROM kyc_requests k
                 JOIN users u ON k.user_id = u.id`;
    const params = [];

    if (status) {
      params.push(status);
      query += ` WHERE k.status = $1`;
    }

    query += ' ORDER BY k.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);

  } catch (error) {
    logger.error('Erreur liste KYC', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { submitKYC, getKYCStatus, reviewKYC, getAllKYC };