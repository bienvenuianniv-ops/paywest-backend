const pool = require('../config/db');
const logger = require('../config/logger');

const auditLog = (action) => {
  return async (req, res, next) => {
    // Sauvegarder la fonction json originale
    const originalJson = res.json.bind(res);

    // Intercepter la réponse
    res.json = async (data) => {
      // Enregistrer l'action seulement si succès (status < 400)
      if (res.statusCode < 400 && req.user) {
        try {
          await pool.query(
            `INSERT INTO audit_logs (user_id, action, details, ip_address)
             VALUES ($1, $2, $3, $4)`,
            [
              req.user.id,
              action,
              JSON.stringify({
                body: req.body,
                params: req.params,
                query: req.query,
                response_status: res.statusCode
              }),
              req.headers['x-forwarded-for'] || req.ip || 'unknown'
            ]
          );
          logger.info('Action auditée', { userId: req.user.id, action });
        } catch (error) {
          logger.error('Erreur audit log', { error: error.message });
        }
      }
      return originalJson(data);
    };

    next();
  };
};

module.exports = auditLog;