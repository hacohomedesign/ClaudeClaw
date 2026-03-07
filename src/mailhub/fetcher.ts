import { sanitizeEmailBody } from './sanitizer.js';
import { classifyEmail } from './classifier.js';
import { insertEmail, getEmailByMessageId, upsertThread, insertAttachment, updateEmailSummary, updateAccountLastPoll } from './store.js';
import { embedText, storeEmbedding } from './embeddings.js';
import { summarizeEmail } from './summarizer.js';
import { classifyAttachment } from './attachments.js';
import { logger } from '../logger.js';
import type { MailAccount } from './types.js';

export interface RawEmailData {
  gmailId: string;
  messageId: string;
  threadId: string;
  from: string;       // "Name <email>" or just "email"
  to?: string;
  subject: string;
  body: string;        // HTML or plain text
  receivedAt: number;  // unix timestamp
  labels?: string[];
  attachments?: Array<{
    filename: string;
    mimeType: string;
    sizeBytes: number;
    gmailAttId: string;
  }>;
}

function parseFromField(from: string): { name?: string; addr: string } {
  const match = from.match(/^(.+?)\s*<(.+)>$/);
  if (match) return { name: match[1].trim(), addr: match[2].trim() };
  return { addr: from.trim() };
}

export async function processRawEmail(accountId: string, raw: RawEmailData): Promise<number | null> {
  // Dedup check
  const existing = getEmailByMessageId(raw.messageId);
  if (existing) {
    logger.debug({ messageId: raw.messageId }, 'Email already exists, skipping');
    return null;
  }

  const { name: fromName, addr: fromAddr } = parseFromField(raw.from);
  const { sanitized, injectionScore } = sanitizeEmailBody(raw.body);
  const { category, urgency } = classifyEmail(raw.subject, fromAddr, sanitized);

  const emailId = insertEmail({
    accountId,
    gmailId: raw.gmailId,
    messageId: raw.messageId,
    threadId: raw.threadId,
    fromAddr,
    fromName,
    toAddr: raw.to,
    subject: raw.subject,
    bodySanitized: sanitized,
    category,
    urgency,
    injectionScore,
    status: 'unread',
    hasAttachments: (raw.attachments?.length ?? 0) > 0,
    receivedAt: raw.receivedAt,
    fetchedAt: Math.floor(Date.now() / 1000),
    labels: raw.labels,
  });

  // Upsert thread
  upsertThread({
    threadId: raw.threadId,
    accountId,
    subject: raw.subject,
    participants: [fromAddr, ...(raw.to ? [raw.to] : [])],
    messageCount: 1,
    lastMessageAt: raw.receivedAt,
    status: 'active',
  });

  // Store attachments metadata
  if (raw.attachments) {
    for (const att of raw.attachments) {
      const meta = classifyAttachment(att.filename, att.mimeType, att.sizeBytes);
      insertAttachment({
        emailId,
        filename: att.filename,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        gmailAttId: att.gmailAttId,
        riskLevel: meta.riskLevel,
      });
    }
  }

  // Async: embed, summarize (fire and forget errors)
  try {
    const embedding = await embedText(`${raw.subject} ${sanitized.slice(0, 500)}`);
    if (embedding) await storeEmbedding(emailId, embedding);
  } catch (err) {
    logger.error({ err, emailId }, 'Embedding failed');
  }

  try {
    const summary = await summarizeEmail(raw.subject, raw.from, sanitized);
    updateEmailSummary(emailId, summary);
  } catch (err) {
    logger.error({ err, emailId }, 'Summarization failed');
  }

  updateAccountLastPoll(accountId, Math.floor(Date.now() / 1000));

  logger.info({ emailId, accountId, subject: raw.subject.slice(0, 60) }, 'Email processed');
  return emailId;
}

// For gog accounts — shell out to gog CLI to fetch emails
export function fetchViaGog(account: MailAccount): RawEmailData[] {
  // TODO: implement when personal/SCI OAuth is configured
  logger.info({ accountId: account.id }, 'gog fetch not yet configured');
  return [];
}

// Build the prompt that the scheduler agent should execute to fetch MCP emails
export function buildMcpFetchPrompt(account: MailAccount): string {
  const sinceHours = 2;
  return `Search for recent emails in the Gmail account ${account.email} using the MCP google-workspace tools.

Use search_gmail_messages with query "newer_than:${sinceHours}h${account.id === 'gs1' ? ' to:rm+gs1@360sc.io' : account.id === 'rorworld' ? ' to:rolland.melet@rorworld.eu' : ''}" and user_google_email "rm@360sc.io".

For each email found, get its full content using get_gmail_message_content.

Return the results as a JSON array with this exact format (no other text):
[{
  "gmailId": "...",
  "messageId": "...",
  "threadId": "...",
  "from": "Name <email>",
  "to": "...",
  "subject": "...",
  "body": "...",
  "receivedAt": unix_timestamp,
  "labels": ["INBOX", ...],
  "attachments": [{"filename": "...", "mimeType": "...", "sizeBytes": 0, "gmailAttId": "..."}]
}]

If no emails found, return an empty array: []`;
}
