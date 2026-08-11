const pool = require('../../src/config/db');
const {
  getPayoutDestinationId,
  resetPayoutDestinationCache
} = require('../../src/services/payoutDestination');

const ORIGINAL_EMAIL = process.env.PAYOUT_DESTINATION_EMAIL;

beforeEach(() => {
  resetPayoutDestinationCache();
  process.env.PAYOUT_DESTINATION_EMAIL = ORIGINAL_EMAIL;
});

afterAll(() => {
  process.env.PAYOUT_DESTINATION_EMAIL = ORIGINAL_EMAIL;
  resetPayoutDestinationCache();
});

describe('payoutDestination', () => {

  it('resout l id du compte configure', async () => {
    const expected = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [ORIGINAL_EMAIL]
    );

    const id = await getPayoutDestinationId();

    expect(id).toBe(expected.rows[0].id);
  });

  it('memorise la resolution et ne requete la base qu une fois', async () => {
    const spy = jest.spyOn(pool, 'query');

    await getPayoutDestinationId();
    const callsAfterFirst = spy.mock.calls.length;
    await getPayoutDestinationId();

    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    spy.mockRestore();
  });

  it('leve une erreur explicite si la variable est absente', async () => {
    delete process.env.PAYOUT_DESTINATION_EMAIL;

    await expect(getPayoutDestinationId()).rejects.toThrow(/PAYOUT_DESTINATION_EMAIL/);
  });

  it('leve une erreur si l email ne correspond a aucun compte', async () => {
    process.env.PAYOUT_DESTINATION_EMAIL = 'inconnu-au-bataillon@paywest.test';

    await expect(getPayoutDestinationId()).rejects.toThrow(/introuvable/i);
  });

  it('refuse un email qui designe le compte plateforme lui-meme', async () => {
    process.env.PAYOUT_DESTINATION_EMAIL = 'platform@paywest.internal';

    await expect(getPayoutDestinationId()).rejects.toThrow(/plateforme/i);
  });

  it('refuse un compte beneficiaire connectable', async () => {
    // Toute la surete du decaissement tient a ce que le beneficiaire n'ait pas
    // de session : un jeton admin vole peut declencher un decaissement, il ne
    // doit pas pouvoir en recuperer le produit. Deux chemins mènent pourtant a
    // un beneficiaire connectable — une variable repointee vers un compte de
    // login, et l'inscription d'un compte a l'adresse reservee avant que le
    // vrai compte ne soit cree (/api/auth/register est ouvert et ne reserve
    // aucune adresse). Le compte admin sert ici de compte connectable reel.
    process.env.PAYOUT_DESTINATION_EMAIL = 'bienvenu@paywest.com';

    await expect(getPayoutDestinationId()).rejects.toThrow(/connectable/i);
  });
});
