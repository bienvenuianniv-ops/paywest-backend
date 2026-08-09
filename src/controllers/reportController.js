const pool = require('../config/db');
const ExcelJS = require('exceljs');
const logger = require('../config/logger');

// Export Excel des transactions
const exportTransactionsExcel = async (req, res) => {
  const { start_date, end_date, type } = req.query;

  try {
    let whereClause = 'WHERE 1=1';
    const params = [];

    if (start_date) {
      params.push(start_date);
      whereClause += ` AND t.created_at >= $${params.length}`;
    }

    if (end_date) {
      params.push(end_date);
      whereClause += ` AND t.created_at <= $${params.length}`;
    }

    if (type) {
      params.push(type);
      whereClause += ` AND t.type = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT t.*,
              s.full_name as sender_name, s.phone as sender_phone,
              r.full_name as receiver_name, r.phone as receiver_phone
       FROM transactions t
       JOIN users s ON t.sender_id = s.id
       JOIN users r ON t.receiver_id = r.id
       ${whereClause}
       ORDER BY t.created_at DESC`,
      params
    );

    // Créer le fichier Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PayWest';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Transactions PayWest', {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });

    // En-tête avec style
    sheet.mergeCells('A1:H1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = '📊 RAPPORT TRANSACTIONS PAYWEST';
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EAD69' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 35;

    // Sous-titre avec période
    sheet.mergeCells('A2:H2');
    const subtitleCell = sheet.getCell('A2');
    subtitleCell.value = `Généré le ${new Date().toLocaleDateString('fr-FR')} | Total : ${result.rows.length} transactions`;
    subtitleCell.font = { italic: true, size: 11, color: { argb: 'FF666666' } };
    subtitleCell.alignment = { horizontal: 'center' };
    sheet.getRow(2).height = 20;

    // Ligne vide
    sheet.addRow([]);

    // Colonnes
    sheet.columns = [
      { key: 'id', width: 8 },
      { key: 'date', width: 20 },
      { key: 'type', width: 15 },
      { key: 'sender', width: 25 },
      { key: 'receiver', width: 25 },
      { key: 'amount', width: 18 },
      { key: 'status', width: 15 },
      { key: 'reference', width: 20 }
    ];

    // En-têtes des colonnes
    const headerRow = sheet.addRow([
      'ID', 'Date', 'Type', 'Expéditeur', 'Destinataire', 'Montant (XOF)', 'Statut', 'Référence'
    ]);

    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A231B' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });
    sheet.getRow(4).height = 25;

    // Types en français
    const typeLabels = {
      transfer: 'Transfert',
      credit: 'Crédit',
      payment: 'Paiement',
      deposit: 'Dépôt',
      withdraw: 'Retrait'
    };

    const statusLabels = {
      completed: 'Succès',
      pending: 'En attente',
      failed: 'Échoué'
    };

    const statusColors = {
      completed: 'FF0EAD69',
      pending: 'FFC9A84C',
      failed: 'FFE2574B'
    };

    // Données
    result.rows.forEach((tx, index) => {
      const row = sheet.addRow([
        tx.id,
        new Date(tx.created_at).toLocaleString('fr-FR'),
        typeLabels[tx.type] || tx.type,
        `${tx.sender_name} (${tx.sender_phone})`,
        `${tx.receiver_name} (${tx.receiver_phone})`,
        parseFloat(tx.amount).toLocaleString('fr-FR'),
        statusLabels[tx.status] || tx.status,
        `PAY-${tx.id}-${new Date(tx.created_at).toISOString().slice(0, 10)}`
      ]);

      // Alternance couleurs
      if (index % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F9F5' } };
        });
      }

      // Couleur statut
      const statusCell = row.getCell(7);
      statusCell.font = { bold: true, color: { argb: statusColors[tx.status] || 'FF000000' } };

      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFEEEEEE' } },
          bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } },
          left: { style: 'thin', color: { argb: 'FFEEEEEE' } },
          right: { style: 'thin', color: { argb: 'FFEEEEEE' } }
        };
        cell.alignment = { vertical: 'middle' };
      });
      row.height = 20;
    });

    // Ligne de total
    sheet.addRow([]);
    const totalRow = sheet.addRow([
      '', '', '', '', 'TOTAL',
      result.rows.reduce((sum, tx) => sum + parseFloat(tx.amount), 0).toLocaleString('fr-FR') + ' XOF',
      '', ''
    ]);
    totalRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0EAD69' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });

    logger.info('Rapport Excel généré', { adminId: req.user.id, count: result.rows.length });

    // Envoyer le fichier
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=PayWest-Rapport-${new Date().toISOString().slice(0, 10)}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    logger.error('Erreur génération rapport Excel', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Résumé financier
const getFinancialSummary = async (req, res) => {
  const { month, year } = req.query;

  try {
    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear = year || new Date().getFullYear();

    const summary = await pool.query(
      `SELECT 
        type,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total,
        COALESCE(AVG(amount), 0) as average,
        COALESCE(MAX(amount), 0) as max_amount,
        COALESCE(MIN(amount), 0) as min_amount
       FROM transactions
       WHERE status = 'completed'
       AND EXTRACT(MONTH FROM created_at) = $1
       AND EXTRACT(YEAR FROM created_at) = $2
       GROUP BY type`,
      [currentMonth, currentYear]
    );

    const totalVolume = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE status = 'completed'
       AND EXTRACT(MONTH FROM created_at) = $1
       AND EXTRACT(YEAR FROM created_at) = $2`,
      [currentMonth, currentYear]
    );

    res.json({
      period: `${currentMonth}/${currentYear}`,
      total_volume: parseFloat(totalVolume.rows[0].total),
      by_type: summary.rows
    });

  } catch (error) {
    logger.error('Erreur résumé financier', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { exportTransactionsExcel, getFinancialSummary };