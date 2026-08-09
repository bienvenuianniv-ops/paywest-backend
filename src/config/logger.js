const winston = require('winston');
const Sentry = require('@sentry/node');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    // Afficher dans la console (visible dans les logs Render)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const extra = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `[${timestamp}] ${level}: ${message} ${extra}`;
        })
      )
    })
  ]
});

// Remonte chaque logger.error(...) vers Sentry (si configuré), en plus de la
// console — point d'integration unique puisque tous les controleurs loggent
// deja leurs erreurs via ce logger plutot que d'appeler next(err).
const logError = logger.error.bind(logger);
logger.error = (message, meta = {}) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureMessage(meta.error ? `${message}: ${meta.error}` : message, {
      level: 'error',
      extra: meta
    });
  }
  return logError(message, meta);
};

module.exports = logger;