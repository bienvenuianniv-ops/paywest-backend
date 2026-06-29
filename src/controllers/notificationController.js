const sendEmail = require('../config/mailer');

// Templates d'emails
const templates = {
  welcome: (name) => ({
    subject: 'Bienvenue sur PayWest 🎉',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0F1610;color:#EEF2EE;padding:40px;border-radius:16px">
        <h1 style="color:#0EAD69;font-size:28px;margin-bottom:8px">Pay<span>West</span></h1>
        <p style="color:#7A8F7C;margin-bottom:32px">Transferts sans frontières</p>
        <h2 style="font-size:20px;margin-bottom:16px">Bienvenue ${name} ! 👋</h2>
        <p style="line-height:1.6;color:#7A8F7C">Votre compte PayWest est maintenant actif. Vous pouvez envoyer et recevoir de l'argent à travers l'Afrique et au-delà.</p>
        <div style="background:#1A231B;border-radius:10px;padding:20px;margin:24px 0;border:1px solid rgba(14,173,105,0.2)">
          <p style="color:#0EAD69;font-weight:bold;margin-bottom:8px">✅ Compte activé</p>
          <p style="color:#7A8F7C;font-size:14px">Connectez-vous dès maintenant pour commencer à utiliser PayWest.</p>
        </div>
        <p style="color:#4A5E4C;font-size:12px;margin-top:32px">© 2026 PayWest — Tous droits réservés</p>
      </div>
    `
  }),

  transferSent: (name, amount, receiver) => ({
    subject: `Transfert de ${amount} XOF envoyé ✅`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0F1610;color:#EEF2EE;padding:40px;border-radius:16px">
        <h1 style="color:#0EAD69;font-size:28px;margin-bottom:8px">PayWest</h1>
        <h2 style="font-size:20px;margin-bottom:16px">Transfert effectué 💸</h2>
        <p style="color:#7A8F7C">Bonjour ${name},</p>
        <div style="background:#1A231B;border-radius:10px;padding:20px;margin:24px 0;border:1px solid rgba(226,87,75,0.2)">
          <p style="color:#E2574B;font-size:32px;font-weight:bold;margin:0">-${amount} XOF</p>
          <p style="color:#7A8F7C;margin-top:8px">Envoyé à : <strong style="color:#EEF2EE">${receiver}</strong></p>
        </div>
        <p style="color:#4A5E4C;font-size:12px;margin-top:32px">© 2026 PayWest — Tous droits réservés</p>
      </div>
    `
  }),

  transferReceived: (name, amount, sender) => ({
    subject: `Vous avez reçu ${amount} XOF 🎉`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0F1610;color:#EEF2EE;padding:40px;border-radius:16px">
        <h1 style="color:#0EAD69;font-size:28px;margin-bottom:8px">PayWest</h1>
        <h2 style="font-size:20px;margin-bottom:16px">Argent reçu 💰</h2>
        <p style="color:#7A8F7C">Bonjour ${name},</p>
        <div style="background:#1A231B;border-radius:10px;padding:20px;margin:24px 0;border:1px solid rgba(14,173,105,0.2)">
          <p style="color:#0EAD69;font-size:32px;font-weight:bold;margin:0">+${amount} XOF</p>
          <p style="color:#7A8F7C;margin-top:8px">Reçu de : <strong style="color:#EEF2EE">${sender}</strong></p>
        </div>
        <p style="color:#4A5E4C;font-size:12px;margin-top:32px">© 2026 PayWest — Tous droits réservés</p>
      </div>
    `
  })
};

// Envoyer email de bienvenue
const sendWelcome = async (email, name) => {
  const { subject, html } = templates.welcome(name);
  await sendEmail(email, subject, html);
};

// Envoyer notification de transfert
const sendTransferNotification = async (senderEmail, senderName, receiverEmail, receiverName, amount) => {
  const sent = templates.transferSent(senderName, amount, receiverName);
  const received = templates.transferReceived(receiverName, amount, senderName);
  await sendEmail(senderEmail, sent.subject, sent.html);
  await sendEmail(receiverEmail, received.subject, received.html);
};

module.exports = { sendWelcome, sendTransferNotification };