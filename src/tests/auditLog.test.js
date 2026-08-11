const auditLog = require('../../src/middleware/auditLog');

describe('auditLog.redactBody', () => {

  it('masque le code OTP', () => {
    const result = auditLog.redactBody({ amount: 5000, otp_code: '123456' });

    expect(result.otp_code).toBe('[masqué]');
    expect(result.amount).toBe(5000);
  });

  it('masque les mots de passe', () => {
    const result = auditLog.redactBody({ email: 'a@b.c', password: 'secret', new_password: 'secret2' });

    expect(result.password).toBe('[masqué]');
    expect(result.new_password).toBe('[masqué]');
    expect(result.email).toBe('a@b.c');
  });

  it('ne modifie pas l objet d origine', () => {
    const body = { otp_code: '123456' };

    auditLog.redactBody(body);

    expect(body.otp_code).toBe('123456');
  });

  it('n ajoute pas de champ absent du body', () => {
    const result = auditLog.redactBody({ amount: 5000 });

    expect(Object.prototype.hasOwnProperty.call(result, 'otp_code')).toBe(false);
  });

  it('tolere un body absent ou non objet', () => {
    expect(auditLog.redactBody(undefined)).toBeUndefined();
    expect(auditLog.redactBody(null)).toBeNull();
    expect(auditLog.redactBody('texte')).toBe('texte');
  });
});
