const { computeFee, FEE_TIERS } = require('../services/feeService');

// Ce fichier ne require PAS src/index.js : le calcul des frais est une
// fonction pure, il n'a aucune raison de payer une connexion Neon.

describe('computeFee — paliers', () => {
  it.each([
    [1, 100],
    [5000, 100],
    [5001, 250],
    [25000, 250],
    [25001, 500],
    [50000, 500],
    [50001, 1000],
    [100000, 1000],
    [100001, 2500],
    [500000, 2500],
    [500001, 5000],
    [10000000, 5000]
  ])('facture %i XOF a %i XOF de frais', (amount, expected) => {
    expect(computeFee(amount)).toBe(expected);
  });

  // Les bornes sont le seul endroit ou une erreur de < au lieu de <= se voit.
  it('place 5000 dans le premier palier et 5001 dans le deuxieme', () => {
    expect(computeFee(5000)).toBe(100);
    expect(computeFee(5001)).toBe(250);
  });

  // Un montant decimal tombe "entre" deux paliers. L'API ne peut pas en
  // recevoir (le validateur impose isInt), mais computeFee est une fonction
  // publique du service : la selection se fait sur la borne haute seule pour
  // qu'aucun montant ne puisse rester sans palier. Defense en profondeur.
  it('applique le palier superieur a un montant entre deux paliers', () => {
    expect(computeFee(5000.5)).toBe(250);
    expect(computeFee(100000.75)).toBe(2500);
  });
});

describe('computeFee — entrees invalides', () => {
  it.each([[0], [-100], [NaN], [Infinity], ['abc'], [null], [undefined], [{}]])(
    'leve une erreur pour %p',
    (value) => {
      expect(() => computeFee(value)).toThrow('Montant invalide');
    }
  );
});

describe('FEE_TIERS', () => {
  it('est ordonne par borne haute croissante et sans trou', () => {
    for (let i = 1; i < FEE_TIERS.length; i++) {
      expect(FEE_TIERS[i].max).toBeGreaterThan(FEE_TIERS[i - 1].max);
      expect(FEE_TIERS[i].min).toBe(FEE_TIERS[i - 1].max + 1);
    }
  });

  it('couvre tous les montants jusqu a l infini', () => {
    expect(FEE_TIERS[FEE_TIERS.length - 1].max).toBe(Infinity);
  });
});
