const AfricasTalking = require('africastalking');
const logger = require('./logger');

const africastalking = AfricasTalking({
  apiKey: process.env.AFRICASTALKING_API_KEY,
  username: process.env.AFRICASTALKING_USERNAME
});

const sms = africastalking.SMS;

const sendSMS = async (to, message) => {
  // Formater le numéro avec indicatif international
  let phone = to.replace(/\s/g, '');
  if (!phone.startsWith('+')) {
    phone = '+221' + phone;
  }

  const result = await sms.send({
    to: [phone],
    message
  });

  logger.info('SMS envoyé', { to: phone, status: result.SMSMessageData?.Message });
  return result;
};

// Templates SMS PayWest
const sendWelcomeSMS = async (phone, name) => {
  const message = `Bienvenue sur PayWest, ${name} ! Votre compte est activé. Envoyez et recevez de l'argent facilement. Support: support@mayouservice.com`;
  return sendSMS(phone, message);
};

const sendTransferSMS = async (senderPhone, receiverPhone, senderName, receiverName, amount) => {
  // Les deux envois sont indépendants : l'échec de l'un ne doit pas empêcher l'autre
  const notifications = [
    {
      label: "à l'expéditeur",
      phone: senderPhone,
      message: `PayWest: Vous avez envoyé ${amount.toLocaleString()} XOF à ${receiverName}. Nouveau solde disponible sur pay.mayouservice.com`
    },
    {
      label: 'au destinataire',
      phone: receiverPhone,
      message: `PayWest: Vous avez reçu ${amount.toLocaleString()} XOF de ${senderName}. Consultez votre solde sur pay.mayouservice.com`
    }
  ];

  const results = await Promise.allSettled(
    notifications.map(({ phone, message }) => sendSMS(phone, message))
  );

  const failed = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(`SMS de transfert non envoyé ${notifications[index].label}`, { error: result.reason?.message });
      failed.push(notifications[index].label);
    }
  });

  if (failed.length > 0) {
    throw new Error(`SMS de transfert non envoyé ${failed.join(' et ')}`);
  }
};

const sendDepositSMS = async (phone, amount, operator) => {
  const message = `PayWest: Dépôt de ${amount.toLocaleString()} XOF via ${operator} initié. Suivez votre transaction sur pay.mayouservice.com`;
  return sendSMS(phone, message);
};

const sendWithdrawSMS = async (phone, amount, operator) => {
  const message = `PayWest: Retrait de ${amount.toLocaleString()} XOF vers ${operator} initié. Délai: 2-5 minutes. Support: support@mayouservice.com`;
  return sendSMS(phone, message);
};

const sendOtpSMS = async (phone, code) => {
  const message = `PayWest: Votre code de confirmation est ${code}. Valable 5 minutes. Ne le partagez avec personne.`;
  return sendSMS(phone, message);
};

module.exports = { sendSMS, sendWelcomeSMS, sendTransferSMS, sendDepositSMS, sendWithdrawSMS, sendOtpSMS };