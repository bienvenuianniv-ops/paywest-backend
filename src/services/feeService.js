// Grille tarifaire des transferts P2P (XOF).
//
// La grille vit ici, en constante de code, et non en base : elle est ainsi
// versionnee dans git, testable sans base, et aucune route admin ne peut
// modifier une regle monetaire (un compte admin compromis se fabriquerait
// sinon un bareme a 100 %). Voir docs/superpowers/specs/2026-08-10-moteur-frais-design.md
//
// `min` n'est present que pour l'affichage de la grille via GET /api/fees.
// La SELECTION du palier se fait sur `max` seul : un montant tombant entre
// deux paliers (5000.5) ne correspondrait a aucune plage [min, max]. Le
// validateur de /send impose deja isInt, donc ce cas n'arrive pas par l'API —
// mais cette fonction est publique et ne doit jamais rendre "aucun palier".
const FEE_TIERS = [
  { min: 0,       max: 5000,     fee: 100  },
  { min: 5001,    max: 25000,    fee: 250  },
  { min: 25001,   max: 50000,    fee: 500  },
  { min: 50001,   max: 100000,   fee: 1000 },
  { min: 100001,  max: 500000,   fee: 2500 },
  { min: 500001,  max: Infinity, fee: 5000 }
];

const computeFee = (amount) => {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Montant invalide pour le calcul des frais');
  }

  const tier = FEE_TIERS.find((t) => value <= t.max);
  return tier.fee;
};

module.exports = { FEE_TIERS, computeFee };
