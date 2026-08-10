const mockSend = jest.fn();

jest.mock('africastalking', () => jest.fn(() => ({ SMS: { send: mockSend } })));
jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const logger = require('../../src/config/logger');
const { sendTransferSMS } = require('../../src/config/sms');

describe('sendTransferSMS', () => {
  beforeEach(() => {
    // mockReset (et pas mockClear) : vide aussi la file des mock*ValueOnce non consommés
    jest.resetAllMocks();
    mockSend.mockResolvedValue({ SMSMessageData: { Message: 'Sent' } });
  });

  it('envoie un SMS à l\'expéditeur et au destinataire', async () => {
    await sendTransferSMS('+221770000001', '+221770000002', 'Awa', 'Moussa', 150000);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].to).toEqual(['+221770000001']);
    expect(mockSend.mock.calls[0][0].message).toContain('envoyé');
    expect(mockSend.mock.calls[1][0].to).toEqual(['+221770000002']);
    expect(mockSend.mock.calls[1][0].message).toContain('reçu');
  });

  it('notifie quand même le destinataire si le SMS à l\'expéditeur échoue', async () => {
    mockSend
      .mockRejectedValueOnce(new Error('numéro expéditeur invalide'))
      .mockResolvedValueOnce({ SMSMessageData: { Message: 'Sent' } });

    await expect(
      sendTransferSMS('+221770000001', '+221770000002', 'Awa', 'Moussa', 150000)
    ).rejects.toThrow("à l'expéditeur");

    // Le second envoi doit avoir été tenté malgré l'échec du premier
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0].to).toEqual(['+221770000002']);
  });

  it('notifie quand même l\'expéditeur si le SMS au destinataire échoue', async () => {
    mockSend
      .mockResolvedValueOnce({ SMSMessageData: { Message: 'Sent' } })
      .mockRejectedValueOnce(new Error('numéro destinataire invalide'));

    await expect(
      sendTransferSMS('+221770000001', '+221770000002', 'Awa', 'Moussa', 150000)
    ).rejects.toThrow('au destinataire');

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].to).toEqual(['+221770000001']);
  });

  it('journalise chaque échec séparément et les signale tous les deux', async () => {
    mockSend.mockRejectedValue(new Error('service SMS indisponible'));

    await expect(
      sendTransferSMS('+221770000001', '+221770000002', 'Awa', 'Moussa', 150000)
    ).rejects.toThrow("à l'expéditeur et au destinataire");

    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
