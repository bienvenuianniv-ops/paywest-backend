const { FEE_TIERS, computeFee } = require('../services/feeService');

// Grille tarifaire, pour affichage dans l'app.
const getFeeGrid = (req, res) => {
  res.json({
    currency: 'XOF',
    tiers: FEE_TIERS.map((tier) => ({
      min: tier.min,
      // Infinity ne survit pas a JSON.stringify : on l'expose explicitement
      // en null, que le client lit comme "sans limite haute".
      max: Number.isFinite(tier.max) ? tier.max : null,
      fee: tier.fee
    }))
  });
};

// Devis avant confirmation : l'app affiche le cout reel a l'utilisateur.
const getQuote = (req, res) => {
  const amount = Number(req.query.amount);

  // Number('') vaut 0 et Number(undefined) vaut NaN : les cas "vide" et
  // "absent" sont donc couverts par cette seule garde.
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const fee = computeFee(amount);

  res.json({
    amount,
    fee,
    total_debit: amount + fee,
    receiver_gets: amount
  });
};

module.exports = { getFeeGrid, getQuote };
