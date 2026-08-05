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

const { authLimiter, generalLimiter } = require('./middleware/rateLimitMiddleware');

const app = express();
const PORT = process.env.PORT || 5000;

// Un seul reverse proxy devant l'app (hébergeur PaaS) : on lui fait
// confiance pour le X-Forwarded-For, sinon express-rate-limit voit
// l'IP du proxy pour tout le monde et mélange les compteurs de tous
// les utilisateurs derrière la même limite.
app.set('trust proxy', 1);

// Domaines autorisés à appeler l'API. En dev, on ajoute localhost
// pour ne pas avoir à changer cette liste à chaque test local.
const allowedOrigins = [
  'https://pay.mayouservice.com',
  'http://localhost:3000',
  'http://localhost:5173'
];

const corsOptions = {
  origin: (origin, callback) => {
    // origin est undefined pour les requêtes sans navigateur (Postman, curl, etc.)
    // — on les laisse passer, elles ne sont pas concernées par le risque CORS.
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
app.use('/api', generalLimiter); // limite générale sur toute l'API

// Routes
app.use('/api/auth', authLimiter, authRoutes); // limite stricte en plus, spécifique à l'auth
app.use('/api/wallet', walletRoutes);
app.use('/api/transactions', transactionLimiter, transactionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/deposit', depositRoutes);
app.use('/api/orange', orangeRoutes);

// Route de test
app.get('/', (req, res) => {
  res.json({ message: 'PayWest API is running 🚀' });
});

// Handler d'erreur global : filet de sécurité pour les erreurs qui
// n'ont pas été catchées par une route (rejet CORS, JSON malformé...).
// Sans ça, Express renvoie sa page d'erreur par défaut avec la stack
// trace complète, faute de NODE_ENV=production défini sur l'hébergeur.
app.use((err, req, res, next) => {
  console.error('Erreur non gérée:', err.message);
  res.status(err.status || 500).json({ message: 'Erreur serveur, veuillez réessayer plus tard' });
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur PayWest démarré sur le port ${PORT}`);
});