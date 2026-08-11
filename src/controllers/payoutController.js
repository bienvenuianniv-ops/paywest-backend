const pool = require('../config/db');
const logger = require('../config/logger');
const { getPlatformUserId } = require('../services/platformAccount');
const { getPayoutDestinationId } = require('../services/payoutDestination');

const getPlatformBalance = async (req, res) => {
  try {
    const platformUserId = await getPlatformUserId();

    const result = await pool.query(
      'SELECT balance, currency FROM wallets WHERE user_id = $1',
      [platformUserId]
    );

    if (result.rows.length === 0) {
      logger.error('Wallet plateforme introuvable', { platformUserId });
      return res.status(500).json({ message: 'Compte plateforme non configuré' });
    }

    res.json({
      platform_user_id: platformUserId,
      balance: parseFloat(result.rows[0].balance),
      currency: result.rows[0].currency
    });

  } catch (error) {
    logger.error('Erreur consultation solde plateforme', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Place AVANT requireOtp dans la chaine : un montant a virgule ou negatif est
// fini et superieur au seuil 0, il declencherait donc un defi OTP — et un vrai
// SMS — avant d'etre rejete par le controleur. On refuse la saisie invalide au
// plus tot.
//
// Entier strictement positif : les wallets sont en DECIMAL(15,2), mais un
// decaissement est une operation de tresorerie saisie a la main, pas un calcul.
// Refuser les decimales evite les surprises d'arrondi.
const validatePayoutAmount = (req, res, next) => {
  const amount = Number(req.body?.amount);

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({
      message: 'Montant invalide : un entier strictement positif est attendu'
    });
  }

  next();
};

const createPayout = async (req, res) => {
  // Deja valide par validatePayoutAmount, qui precede cette fonction dans la
  // chaine de la route : entier strictement positif garanti.
  const amount = Number(req.body.amount);

  let platformUserId;
  let destinationUserId;
  try {
    platformUserId = await getPlatformUserId();
    destinationUserId = await getPayoutDestinationId();
  } catch (error) {
    // Variable absente, email inconnu, ou beneficiaire egal au compte
    // plateforme : c'est une erreur de configuration serveur, jamais une
    // erreur de l'appelant.
    logger.error('Décaissement indisponible', { error: error.message });
    return res.status(500).json({
      message: 'Décaissement indisponible : compte de destination non configuré'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verrous pris beneficiaire d'abord, plateforme en dernier — jamais
    // l'inverse. L'invariant reel est que le wallet plateforme est TOUJOURS le
    // dernier verrou pris dans une transaction : sendMoney verrouille
    // l'expediteur, puis le destinataire, puis la plateforme en dernier (via
    // l'UPDATE des frais). En reprenant le meme ordre ici (beneficiaire, puis
    // plateforme), les deux chemins de code sont compatibles sans condition
    // sur les id — contrairement a un tri par id, qui ne supprimait le cycle
    // ABBA que tant que l'id du beneficiaire restait inferieur a celui de la
    // plateforme, et qui aurait donc reintroduit un deadlock avec tout futur
    // beneficiaire cree apres le compte plateforme.
    //
    // Deux requetes explicites plutot que WHERE user_id IN (...) ORDER BY ...
    // FOR UPDATE : avec un noeud de tri, PostgreSQL verrouille dans l'ordre du
    // parcours, pas dans l'ordre trie — la garantie serait illusoire.
    const firstLock = await client.query(
      'SELECT user_id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [destinationUserId]
    );
    const secondLock = await client.query(
      'SELECT user_id, balance FROM wallets WHERE user_id = $1 FOR UPDATE',
      [platformUserId]
    );

    // Un beneficiaire (ou, en theorie, la plateforme elle-meme) sans ligne
    // dans wallets est un trou reel : sans cette verification, l'UPDATE plus
    // bas touche 0 ligne en silence, la plateforme est quand meme debitee, la
    // transaction est inseree, et l'argent disparait sans que rien ne le
    // signale.
    if (firstLock.rows.length !== 1 || secondLock.rows.length !== 1) {
      await client.query('ROLLBACK');
      logger.error('Wallet introuvable pour le decaissement', {
        platformUserId,
        destinationUserId,
        firstFound: firstLock.rows.length === 1,
        secondFound: secondLock.rows.length === 1
      });
      return res.status(500).json({ message: 'Compte plateforme ou bénéficiaire non configuré' });
    }

    const platformWallet = [...firstLock.rows, ...secondLock.rows].find(
      (row) => row.user_id === platformUserId
    );

    const balance = parseFloat(platformWallet.balance);

    if (balance < amount) {
      await client.query('ROLLBACK');
      logger.warn('Décaissement refusé, solde plateforme insuffisant', { amount, balance });
      return res.status(400).json({
        message: `Solde plateforme insuffisant : ${balance.toLocaleString('fr-FR')} XOF disponibles`,
        balance,
        amount
      });
    }

    await client.query(
      'UPDATE wallets SET balance = balance - $1, updated_at = NOW() WHERE user_id = $2',
      [amount, platformUserId]
    );

    await client.query(
      'UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
      [amount, destinationUserId]
    );

    // fee omis volontairement : la colonne est NOT NULL DEFAULT 0, et un
    // decaissement n'est pas un transfert P2P — aucun frais ne s'y applique.
    const transaction = await client.query(
      `INSERT INTO transactions (sender_id, receiver_id, amount, type, status)
       VALUES ($1, $2, $3, 'payout', 'completed') RETURNING *`,
      [platformUserId, destinationUserId, amount]
    );

    await client.query('COMMIT');

    logger.info('Décaissement plateforme effectué', {
      adminId: req.user.id,
      amount,
      platformUserId,
      destinationUserId,
      platformBalanceAfter: balance - amount
    });

    res.json({
      message: 'Décaissement effectué',
      transaction: transaction.rows[0],
      platform_balance: balance - amount
    });

  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Erreur décaissement plateforme', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
  } finally {
    client.release();
  }
};

module.exports = { getPlatformBalance, validatePayoutAmount, createPayout };
