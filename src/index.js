const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Imports des routes
const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const merchantRoutes = require('./routes/merchantRoutes');
const depositRoutes = require('./routes/depositRoutes');
const orangeRoutes = require('./routes/orangeRoutes');
const agentRoutes = require('./routes/agentRoutes');
const merchantDashRoutes = require('./routes/merchantDashRoutes');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
const withdrawRoutes = require('./routes/withdrawRoutes');
const currencyRoutes = require('./routes/currencyRoutes');

// Import rate limiter
const { generalLimiter, authLimiter, transactionLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy pour Render
app.set('trust proxy', 1);

// Domaines autorisés
const allowedOrigins = [
  'https://pay.mayouservice.com',
  'http://localhost:3000',
  'http://localhost:5173'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origine non autorisée par CORS'));
    }
  }
};

// Middlewares
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());
app.use('/api', generalLimiter);

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/transactions', transactionLimiter, transactionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/deposit', depositRoutes);
app.use('/api/orange', orangeRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/merchant-dash', merchantDashRoutes);
app.use('/api/withdraw', withdrawRoutes);
app.use('/api/currency', currencyRoutes);

// Route de test
app.get('/', (req, res) => {
  res.json({ message: 'PayWest API is running 🚀' });
});
// Documentation API
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'PayWest API Docs',
  customCss: '.swagger-ui .topbar { background-color: #0EAD69; }',
  customfavIcon: 'https://pay.mayouservice.com/favicon.ico'
}));
// Handler d'erreur global
app.use((err, req, res, next) => {
  console.error('Erreur non gérée:', err.message);
  res.status(err.status || 500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
});

// Démarrage du serveur
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Serveur PayWest démarré sur le port ${PORT}`);
  });
}

module.exports = app;