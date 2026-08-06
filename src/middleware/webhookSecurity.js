const crypto = require('crypto');
const logger = require('../config/logger');

// Vérifier la signature du webhook Wave
const verifyWaveWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-wave-signature'];
    const webhookSecret = process.env.WAVE_WEBHOOK_SECRET;

    // En mode développement sans clé, on laisse passer
    if (!webhookSecret) {
      logger.warn('WAVE_WEBHOOK_SECRET non défini — mode développement');
      return next();
    }

    if (!signature) {
      logger.warn('Webhook Wave rejeté — signature manquante');
      return res.status(401).json({ message: 'Signature manquante' });
    }

    // Calculer la signature attendue
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    // Comparer les signatures de manière sécurisée
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      logger.warn('Webhook Wave rejeté — signature invalide');
      return res.status(401).json({ message: 'Signature invalide' });
    }

    logger.info('Webhook Wave vérifié avec succès');
    next();

  } catch (error) {
    logger.error('Erreur vérification webhook Wave', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

// Vérifier la signature du webhook Orange Money
const verifyOrangeWebhook = (req, res, next) => {
  try {
    const signature = req.headers['x-orange-signature'];
    const webhookSecret = process.env.ORANGE_WEBHOOK_SECRET;

    // En mode développement sans clé, on laisse passer
    if (!webhookSecret) {
      logger.warn('ORANGE_WEBHOOK_SECRET non défini — mode développement');
      return next();
    }

    if (!signature) {
      logger.warn('Webhook Orange rejeté — signature manquante');
      return res.status(401).json({ message: 'Signature manquante' });
    }

    // Calculer la signature attendue
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    // Comparer les signatures de manière sécurisée
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      logger.warn('Webhook Orange rejeté — signature invalide');
      return res.status(401).json({ message: 'Signature invalide' });
    }

    logger.info('Webhook Orange vérifié avec succès');
    next();

  } catch (error) {
    logger.error('Erreur vérification webhook Orange', { error: error.message });
    res.status(500).json({ message: 'Erreur serveur' });
  }
};

module.exports = { verifyWaveWebhook, verifyOrangeWebhook };