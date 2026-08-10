const request = require('supertest');
const app = require('../../src/index');
const pool = require('../../src/config/db');
const { phoneVariants } = require('../../src/utils/phoneHelper');

let token;
let senderId;
let receiverId;
let platformId;

const RECEIVER_PHONE = '+221770000001';
// Sous le seuil OTP de 100 000 : ce fichier teste le prelevement, rien d'autre.
const AMOUNT = 10000;
const EXPECTED_FEE = 250;

const balanceOf = async (userId) => {
  const res = await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId]);
  return parseFloat(res.rows[0].balance);
};

const userIdByPhone = async (phone) => {
  const variants = phoneVariants(phone);
  const placeholders = variants.map((_, i) => `$${i + 1}`).join(', ');
  const res = await pool.query(`SELECT id FROM users WHERE phone IN (${placeholders})`, variants);
  return res.rows[0].id;
};

beforeAll(async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'bienvenu@paywest.com',
      // Aucune valeur de repli en dur : le depot est public.
      password: process.env.TEST_PASSWORD
    });
  token = login.body.token;

  const sender = await pool.query(`SELECT id FROM users WHERE email = 'bienvenu@paywest.com'`);
  senderId = sender.rows[0].id;
  receiverId = await userIdByPhone(RECEIVER_PHONE);

  const platform = await pool.query(`SELECT id FROM users WHERE role = 'platform'`);
  platformId = platform.rows[0].id;
});

// Pas de pool.end() : voir la note dans platformAccount.test.js.

describe('Prelevement des frais sur transfert', () => {
  it('debite l expediteur du montant + frais, credite le destinataire du montant seul et la plateforme des frais', async () => {
    const before = {
      sender: await balanceOf(senderId),
      receiver: await balanceOf(receiverId),
      platform: await balanceOf(platformId)
    };

    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: AMOUNT });

    expect(res.statusCode).toBe(200);
    expect(res.body.fee).toBe(EXPECTED_FEE);
    expect(res.body.total_debit).toBe(AMOUNT + EXPECTED_FEE);
    expect(parseFloat(res.body.transaction.fee)).toBe(EXPECTED_FEE);

    const after = {
      sender: await balanceOf(senderId),
      receiver: await balanceOf(receiverId),
      platform: await balanceOf(platformId)
    };

    expect(after.sender).toBe(before.sender - AMOUNT - EXPECTED_FEE);
    expect(after.receiver).toBe(before.receiver + AMOUNT);
    expect(after.platform).toBe(before.platform + EXPECTED_FEE);

    // L'invariant qui attrape toute erreur de signe ou de montant : rien ne
    // sort du systeme, les frais sont deplaces et non detruits.
    expect(after.sender + after.receiver + after.platform)
      .toBe(before.sender + before.receiver + before.platform);

    // Remise en etat de paywest_test.
    await pool.query('UPDATE wallets SET balance = balance + $1 WHERE user_id = $2', [AMOUNT + EXPECTED_FEE, senderId]);
    await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [AMOUNT, receiverId]);
    await pool.query('UPDATE wallets SET balance = balance - $1 WHERE user_id = $2', [EXPECTED_FEE, platformId]);
    await pool.query('DELETE FROM transactions WHERE id = $1', [res.body.transaction.id]);
  });
});

describe('Solde insuffisant a cause des seuls frais', () => {
  let tempUserId;
  let tempToken;
  const suffix = Date.now().toString().slice(-7);
  const tempPhone = `+22178${suffix}`;
  const tempEmail = `frais.${suffix}@test.paywest`;

  beforeAll(async () => {
    await request(app).post('/api/auth/register').send({
      full_name: 'Test Frais',
      email: tempEmail,
      phone: tempPhone,
      password: 'Test@12345'
    });

    const user = await pool.query('SELECT id FROM users WHERE email = $1', [tempEmail]);
    tempUserId = user.rows[0].id;

    // Solde suffisant pour le montant, insuffisant pour montant + frais.
    await pool.query('UPDATE wallets SET balance = $1 WHERE user_id = $2', [10200, tempUserId]);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: tempEmail, password: 'Test@12345' });
    tempToken = login.body.token;
  });

  afterAll(async () => {
    // Les transactions d'abord : sans ca, la suppression du compte viole
    // transactions_sender_id_fkey des que le transfert a abouti pour une
    // raison quelconque, et le compte jetable reste en base pour toujours.
    await pool.query('DELETE FROM transactions WHERE sender_id = $1 OR receiver_id = $1', [tempUserId]);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [tempUserId]);
    await pool.query('DELETE FROM wallets WHERE user_id = $1', [tempUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [tempUserId]);
  });

  it('refuse le transfert et detaille le manque', async () => {
    const res = await request(app)
      .post('/api/transactions/send')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ receiver_phone: RECEIVER_PHONE, amount: AMOUNT });

    expect(res.statusCode).toBe(400);
    expect(res.body.amount).toBe(AMOUNT);
    expect(res.body.fee).toBe(EXPECTED_FEE);
    expect(res.body.total_required).toBe(AMOUNT + EXPECTED_FEE);
    expect(res.body.balance).toBe(10200);

    // Aucun mouvement : le ROLLBACK a bien tout annule.
    expect(await balanceOf(tempUserId)).toBe(10200);
  });
});
