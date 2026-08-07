const AfricasTalking = require('africastalking');
const logger = require('./logger');

const africastalking = AfricasTalking({
  apiKey: process.env.AFRICASTALKING_API_KEY,
  username: process.env.AFRICASTALKING_USERNAME
});

const sms = africastalking.SMS;

const sendSMS = async (to, message) => {
  try {
    // Formater le numéro avec indicatif international
    const phone = to.startsWith('+') ? to : `+${to}`;

    const result = await sms.send({
  to: [phone],
  message
});

    logger.info('SMS envoyé', { to: phone, status: result.SMSMessageData?.Message });
    return result;

  } catch (error) {
    logger.error('Erreur envoi SMS', { error: error.message, to });
  }
};

// Templates SMS PayWest
const sendWelcomeSMS = async (phone, name) => {
  const message = `Bienvenue sur PayWest, ${name} ! Votre compte est activé. Envoyez et recevez de l'argent facilement. Support: support@mayouservice.com`;
  return sendSMS(phone, message);
};

const sendTransferSMS = async (senderPhone, receiverPhone, senderName, receiverName, amount) => {
  // SMS à l'expéditeur
  await sendSMS(senderPhone, `PayWest: Vous avez envoyé ${amount.toLocaleString()} XOF à ${receiverName}. Nouveau solde disponible sur pay.mayouservice.com`);

  // SMS au destinataire
  await sendSMS(receiverPhone, `PayWest: Vous avez reçu ${amount.toLocaleString()} XOF de ${senderName}. Consultez votre solde sur pay.mayouservice.com`);
};

const sendDepositSMS = async (phone, amount, operator) => {
  const message = `PayWest: Dépôt de ${amount.toLocaleString()} XOF via ${operator} initié. Suivez votre transaction sur pay.mayouservice.com`;
  return sendSMS(phone, message);
};

const sendWithdrawSMS = async (phone, amount, operator) => {
  const message = `PayWest: Retrait de ${amount.toLocaleString()} XOF vers ${operator} initié. Délai: 2-5 minutes. Support: support@mayouservice.com`;
  return sendSMS(phone, message);
};

module.exports = { sendSMS, sendWelcomeSMS, sendTransferSMS, sendDepositSMS, sendWithdrawSMS };