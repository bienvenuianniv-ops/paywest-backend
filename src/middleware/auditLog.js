const pool = require('../config/db');
const logger = require('../config/logger');

// Champs d'authentification qui n'ont rien a faire en clair dans un journal
// consultable via GET /api/admin/audit. Le code OTP en fait partie :
// /api/admin/payout est la premiere route a combiner auditLog et requireOtp,
// et le body d'un decaissement reussi contient le code utilise.
const SENSITIVE_BODY_FIELDS = ['otp_code', 'password', 'new_password', 'old_password', 'pin'];

const redactBody = (body) => {
  if (!body || typeof body !== 'object') return body;

  const safe = { ...body };
  for (const field of SENSITIVE_BODY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(safe, field)) {
      safe[field] = '[masqué]';
    }
  }
  return safe;
};

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
                body: redactBody(req.body),
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
// Attachee plutot qu'exportee dans un objet : tous les fichiers de routes
// font `require('../middleware/auditLog')` et attendent la fonction elle-meme.
module.exports.redactBody = redactBody;