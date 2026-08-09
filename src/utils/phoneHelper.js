// Normaliser un numéro de téléphone
const normalizePhone = (phone) => {
  if (!phone) return null;
  
  // Supprimer espaces, tirets, parenthèses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  
  // Si commence par 00221, remplacer par +221
  if (cleaned.startsWith('00221')) {
    cleaned = '+221' + cleaned.slice(5);
  }
  
  // Si commence par 221 sans +, ajouter +
  if (cleaned.startsWith('221') && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  
  // Si numéro sénégalais sans indicatif (7 ou 8 chiffres commençant par 7)
  if (/^7[0-9]{8}$/.test(cleaned)) {
    cleaned = '+221' + cleaned;
  }
  
  // Si numéro congolais sans indicatif (commençant par 06 ou 05)
  if (/^0[56][0-9]{7}$/.test(cleaned)) {
    cleaned = '+242' + cleaned.slice(1);
  }

  return cleaned;
};

// Chercher un utilisateur par numéro (tous formats)
const phoneVariants = (phone) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  
  const variants = [normalized];
  
  // Sans indicatif +221
  if (normalized.startsWith('+221')) {
    variants.push(normalized.slice(4));
    variants.push('221' + normalized.slice(4));
  }
  
  // Sans indicatif +242 (Congo)
  if (normalized.startsWith('+242')) {
    variants.push(normalized.slice(4));
    variants.push('0' + normalized.slice(4));
  }

  return [...new Set(variants)];
};

module.exports = { normalizePhone, phoneVariants };