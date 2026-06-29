const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Imports des routes
const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const merchantRoutes = require('./routes/merchantRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/merchant', merchantRoutes);

// Route de test
app.get('/', (req, res) => {
  res.json({ message: 'PayWest API is running 🚀' });
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur PayWest démarré sur le port ${PORT}`);
});