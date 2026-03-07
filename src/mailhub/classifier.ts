import type { MailEmail } from './types.js';

type Category = NonNullable<MailEmail['category']>;

const URGENT_PATTERNS = [
  /urgent/i, /asap/i, /immedi?at/i, /deadline\s+(today|demain|tomorrow)/i,
  /action\s+required/i, /required\s+action/i,
];

const ACTION_PATTERNS = [
  /please\s+(confirm|respond|reply|review|approve|sign|validate)/i,
  /merci\s+de\s+(confirmer|répondre|valider|signer)/i,
  /could\s+you/i, /pourriez-vous/i, /peux-tu/i,
  /d'ici\s+(vendredi|lundi|demain)/i, /by\s+(friday|monday|tomorrow)/i,
];

const NEWSLETTER_PATTERNS = [
  /unsubscribe/i, /se\s+désabonner/i, /newsletter/i,
  /list-unsubscribe/i, /mailing\s+list/i,
  /noreply@/i, /no-reply@/i, /mailer-daemon/i,
];

const ADMIN_PATTERNS = [
  /invoice/i, /facture/i, /receipt/i, /reçu/i,
  /password\s+reset/i, /compte/i, /account/i,
  /notification/i, /alert/i, /alerte/i,
];

const SOCIAL_PATTERNS = [
  /linkedin/i, /twitter/i, /facebook/i, /instagram/i,
  /mentioned\s+you/i, /tagged\s+you/i,
];

export function classifyEmail(subject: string, fromAddr: string, body: string): { category: Category; urgency: 0 | 1 | 2 } {
  const text = `${subject} ${body.slice(0, 2000)}`;

  // Urgency
  let urgency: 0 | 1 | 2 = 0;
  if (URGENT_PATTERNS.some(p => p.test(text))) urgency = 2;
  else if (ACTION_PATTERNS.some(p => p.test(text))) urgency = 1;

  // Category
  let category: Category = 'info';
  if (NEWSLETTER_PATTERNS.some(p => p.test(text)) || NEWSLETTER_PATTERNS.some(p => p.test(fromAddr))) {
    category = 'newsletter';
  } else if (SOCIAL_PATTERNS.some(p => p.test(text)) || SOCIAL_PATTERNS.some(p => p.test(fromAddr))) {
    category = 'social';
  } else if (ADMIN_PATTERNS.some(p => p.test(text))) {
    category = 'admin';
  } else if (urgency === 2) {
    category = 'urgent';
  } else if (ACTION_PATTERNS.some(p => p.test(text))) {
    category = 'action';
  }

  return { category, urgency };
}
