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
});
