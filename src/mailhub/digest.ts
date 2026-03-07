import fs from 'fs';
import path from 'path';
import { getEmailsByAccount, getMailSummaryStats, insertDigest, getDigestByDate, getPendingDrafts } from './store.js';
import { MAIL_ACCOUNTS } from './accounts.js';
import { logger } from '../logger.js';
import type { MailEmail } from './types.js';

const VAULT_BASE = '/Users/macminirolland/Library/CloudStorage/GoogleDrive-rm@360sc.io/Mon Drive/OBSIDIAN/CHATTERS';
const MAIL_DIR = path.join(VAULT_BASE, 'mail');

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function emailRef(date: string, index: number): string {
  return `MH-${date}-${String(index).padStart(3, '0')}`;
}

function buildEmailBlock(email: MailEmail, ref: string): string {
  const threadInfo = email.threadId ? ` | **Thread** : ${email.threadId.slice(0, 8)}` : '';
  const injection = email.injectionScore >= 5 ? ' [INJECTION_WARNING]' : '';
  const atts = email.hasAttachments ? ' | Attachments: yes' : '';

  return `### ${email.subject}${injection}
- **De** : ${email.fromName || email.fromAddr} <${email.fromAddr}>
- **Compte** : ${email.accountId} | **Date** : ${formatDate(email.receivedAt)}${threadInfo}
- **Resume** : ${email.summary || 'En cours de generation...'}${atts}
- **Action** : - [ ] vu  - [ ] repondre  - [ ] draft  - [ ] archive
- **Ref** : \`${ref}\`
`;
}

function todayStartTimestamp(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export async function buildDigest(): Promise<string> {
  const date = todayStr();
  fs.mkdirSync(MAIL_DIR, { recursive: true });

  const digestPath = path.join(MAIL_DIR, `${date} Mail Digest.md`);

  const stats = getMailSummaryStats();
  const allEmails: MailEmail[] = [];
  const startTs = todayStartTimestamp();

  for (const account of MAIL_ACCOUNTS) {
    const emails = getEmailsByAccount(account.id, 50);
    allEmails.push(...emails.filter(e => e.receivedAt >= startTs));
  }

  // Sort by urgency DESC, then receivedAt DESC
  allEmails.sort((a, b) => (b.urgency - a.urgency) || (b.receivedAt - a.receivedAt));

  // Get existing digest cycle count
  const existingDigest = getDigestByDate(date);
  const cycle = (existingDigest?.cycle ?? 0) + 1;

  const actionRequired = allEmails.filter(e => e.urgency >= 1 || e.category === 'action' || e.category === 'urgent');

  const now = new Date().toISOString();
  const lastPollTime = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  let md = `---
created: ${now}
type: mail-digest
date: ${date}
cycles: ${cycle}
total_emails: ${allEmails.length}
unread: ${stats.unread}
tags:
  - mail/digest
---

# Mail Digest - ${date}

**Stats** : ${allEmails.length} emails | ${stats.unread} unread | ${actionRequired.length} action | Last poll: ${lastPollTime}

---

`;

  // Action Required section
  if (actionRequired.length > 0) {
    md += `## Action Required\n\n`;
    actionRequired.forEach((email, i) => {
      md += buildEmailBlock(email, emailRef(date, i + 1));
      md += '\n';
    });
    md += '---\n\n';
  }

  // Per account sections
  md += `## Par compte\n\n`;
  for (const account of MAIL_ACCOUNTS) {
    md += `### ${account.label}\n`;
    const accountEmails = allEmails.filter(e => e.accountId === account.id && !actionRequired.includes(e));
    if (accountEmails.length === 0) {
      md += '(none today)\n\n';
    } else {
      accountEmails.forEach((email, i) => {
        md += buildEmailBlock(email, emailRef(date, actionRequired.length + i + 1));
        md += '\n';
      });
    }
  }

  // Pending drafts
  const drafts = getPendingDrafts();
  if (drafts.length > 0) {
    md += `---\n\n## Drafts en attente\n\n`;
    md += `| Ref | Status |\n|-----|--------|\n`;
    for (const draft of drafts) {
      md += `| draft-${draft.id} | ${draft.status} |\n`;
    }
    md += '\n';
  }

  fs.writeFileSync(digestPath, md, 'utf-8');

  // Record digest in DB
  insertDigest({
    date,
    cycle,
    emailsIncluded: allEmails.map(e => e.id!),
    obsidianPath: digestPath,
    telegramSent: false,
    createdAt: Math.floor(Date.now() / 1000),
  });

  logger.info({ digestPath, cycle, emails: allEmails.length }, 'Digest built');
  return digestPath;
}

export function reconcileDigest(): void {
  const date = todayStr();
  const digestPath = path.join(MAIL_DIR, `${date} Mail Digest.md`);

  if (!fs.existsSync(digestPath)) return;

  const content = fs.readFileSync(digestPath, 'utf-8');

  // Parse checkboxes: find [x] vu, [x] archive patterns near ref lines
  const lines = content.split('\n');
  let currentRef: string | null = null;

  for (const line of lines) {
    const refMatch = line.match(/\*\*Ref\*\*\s*:\s*`(MH-[\d-]+)`/);
    if (refMatch) {
      currentRef = refMatch[1];
    }

    if (currentRef && line.includes('- [x] vu')) {
      logger.info({ ref: currentRef }, 'User marked email as read');
    }
    if (currentRef && line.includes('- [x] archive')) {
      logger.info({ ref: currentRef }, 'User marked email for archive');
    }
  }
}
