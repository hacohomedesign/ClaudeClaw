import { getDb } from '../db.js';
import type { MailEmail, MailThread, MailAttachment, MailDigest, MailDraft } from './types.js';

// ── Email CRUD ───────────────────────────────────────────────────────

export function insertEmail(email: Omit<MailEmail, 'id'>): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO mailhub_emails
      (account_id, gmail_id, message_id, thread_id, from_addr, from_name,
       to_addr, subject, body_sanitized, summary, category, urgency,
       injection_score, status, has_attachments, received_at, fetched_at, labels)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    email.accountId, email.gmailId, email.messageId, email.threadId,
    email.fromAddr, email.fromName ?? null,
    email.toAddr ?? null, email.subject, email.bodySanitized,
    email.summary ?? null, email.category ?? null, email.urgency,
    email.injectionScore, email.status, email.hasAttachments ? 1 : 0,
    email.receivedAt, email.fetchedAt,
    email.labels ? JSON.stringify(email.labels) : null,
  );
  return result.lastInsertRowid as number;
}

export function getEmailById(id: number): MailEmail | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mailhub_emails WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToEmail(row) : null;
}

export function getEmailByMessageId(messageId: string): MailEmail | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mailhub_emails WHERE message_id = ?').get(messageId) as Record<string, unknown> | undefined;
  return row ? rowToEmail(row) : null;
}

export function updateEmailStatus(id: number, status: MailEmail['status']): void {
  const db = getDb();
  db.prepare('UPDATE mailhub_emails SET status = ? WHERE id = ?').run(status, id);
}

export function updateEmailSummary(id: number, summary: string): void {
  const db = getDb();
  db.prepare('UPDATE mailhub_emails SET summary = ? WHERE id = ?').run(summary, id);
}

export function updateEmailClassification(id: number, category: string, urgency: number): void {
  const db = getDb();
  db.prepare('UPDATE mailhub_emails SET category = ?, urgency = ? WHERE id = ?').run(category, urgency, id);
}

export function getUnreadEmails(accountId?: string): MailEmail[] {
  const db = getDb();
  if (accountId) {
    const rows = db.prepare(
      "SELECT * FROM mailhub_emails WHERE status = 'unread' AND account_id = ? ORDER BY received_at DESC",
    ).all(accountId) as Record<string, unknown>[];
    return rows.map(rowToEmail);
  }
  const rows = db.prepare(
    "SELECT * FROM mailhub_emails WHERE status = 'unread' ORDER BY received_at DESC",
  ).all() as Record<string, unknown>[];
  return rows.map(rowToEmail);
}

export function getEmailsByAccount(accountId: string, limit = 50): MailEmail[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM mailhub_emails WHERE account_id = ? ORDER BY received_at DESC LIMIT ?',
  ).all(accountId, limit) as Record<string, unknown>[];
  return rows.map(rowToEmail);
}

export function getEmailsByThread(threadId: string): MailEmail[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM mailhub_emails WHERE thread_id = ? ORDER BY received_at ASC',
  ).all(threadId) as Record<string, unknown>[];
  return rows.map(rowToEmail);
}

// ── Thread CRUD ──────────────────────────────────────────────────────

export function upsertThread(thread: MailThread): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO mailhub_threads (thread_id, account_id, subject, participants, message_count, last_message_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      message_count = mailhub_threads.message_count + 1,
      last_message_at = MAX(mailhub_threads.last_message_at, excluded.last_message_at),
      participants = excluded.participants
  `).run(
    thread.threadId, thread.accountId, thread.subject,
    thread.participants ? JSON.stringify(thread.participants) : null,
    thread.messageCount, thread.lastMessageAt, thread.status,
  );
}

export function getThread(threadId: string): MailThread | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mailhub_threads WHERE thread_id = ?').get(threadId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    threadId: row.thread_id as string,
    accountId: row.account_id as string,
    subject: row.subject as string,
    participants: row.participants ? JSON.parse(row.participants as string) as string[] : undefined,
    messageCount: row.message_count as number,
    lastMessageAt: row.last_message_at as number,
    status: row.status as 'active' | 'closed',
  };
}

// ── Attachment CRUD ──────────────────────────────────────────────────

export function insertAttachment(att: Omit<MailAttachment, 'id'>): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO mailhub_attachments (email_id, filename, mime_type, size_bytes, gmail_att_id, risk_level, drive_file_id, drive_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    att.emailId, att.filename, att.mimeType ?? null,
    att.sizeBytes ?? null, att.gmailAttId ?? null,
    att.riskLevel, att.driveFileId ?? null, att.driveUrl ?? null,
  );
  return result.lastInsertRowid as number;
}

export function getAttachmentsByEmail(emailId: number): MailAttachment[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM mailhub_attachments WHERE email_id = ?').all(emailId) as Record<string, unknown>[];
  return rows.map(r => ({
    id: r.id as number,
    emailId: r.email_id as number,
    filename: r.filename as string,
    mimeType: r.mime_type as string | undefined,
    sizeBytes: r.size_bytes as number | undefined,
    gmailAttId: r.gmail_att_id as string | undefined,
    riskLevel: r.risk_level as 'safe' | 'caution' | 'blocked',
    driveFileId: r.drive_file_id as string | undefined,
    driveUrl: r.drive_url as string | undefined,
  }));
}

// ── Digest CRUD ──────────────────────────────────────────────────────

export function insertDigest(digest: Omit<MailDigest, 'id'>): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO mailhub_digests (date, cycle, emails_included, obsidian_path, telegram_sent, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    digest.date, digest.cycle,
    JSON.stringify(digest.emailsIncluded),
    digest.obsidianPath ?? null,
    digest.telegramSent ? 1 : 0,
    digest.createdAt,
  );
  return result.lastInsertRowid as number;
}

export function getDigestByDate(date: string): MailDigest | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mailhub_digests WHERE date = ? ORDER BY cycle DESC LIMIT 1').get(date) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as number,
    date: row.date as string,
    cycle: row.cycle as number,
    emailsIncluded: JSON.parse(row.emails_included as string) as number[],
    obsidianPath: row.obsidian_path as string | undefined,
    telegramSent: (row.telegram_sent as number) === 1,
    createdAt: row.created_at as number,
  };
}

// ── Draft CRUD ───────────────────────────────────────────────────────

export function insertDraft(draft: Omit<MailDraft, 'id'>): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO mailhub_drafts (email_id, draft_body, justification, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    draft.emailId, draft.draftBody,
    draft.justification ?? null, draft.status, draft.createdAt,
  );
  return result.lastInsertRowid as number;
}

export function getDraftsByEmail(emailId: number): MailDraft[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM mailhub_drafts WHERE email_id = ?').all(emailId) as Record<string, unknown>[];
  return rows.map(rowToDraft);
}

export function getPendingDrafts(): MailDraft[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM mailhub_drafts WHERE status = 'proposed' ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToDraft);
}

export function updateDraftStatus(id: number, status: MailDraft['status']): void {
  const db = getDb();
  db.prepare('UPDATE mailhub_drafts SET status = ? WHERE id = ?').run(status, id);
}

// ── Account polling ──────────────────────────────────────────────────

export function updateAccountLastPoll(accountId: string, timestamp: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO mailhub_accounts (id, label, email, fetch_via, active, last_poll, created_at)
    VALUES (?, '', '', 'mcp', 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_poll = excluded.last_poll
  `).run(accountId, timestamp, Math.floor(Date.now() / 1000));
}

// ── Stats ────────────────────────────────────────────────────────────

export function getMailSummaryStats(): { total: number; unread: number; byAccount: Record<string, { total: number; unread: number }> } {
  const db = getDb();
  const overall = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) as unread
    FROM mailhub_emails
  `).get() as { total: number; unread: number };

  const byAccountRows = db.prepare(`
    SELECT
      account_id,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) as unread
    FROM mailhub_emails
    GROUP BY account_id
  `).all() as Array<{ account_id: string; total: number; unread: number }>;

  const byAccount: Record<string, { total: number; unread: number }> = {};
  for (const row of byAccountRows) {
    byAccount[row.account_id] = { total: row.total, unread: row.unread };
  }

  return { total: overall.total, unread: overall.unread, byAccount };
}

// ── Row mappers ──────────────────────────────────────────────────────

function rowToEmail(row: Record<string, unknown>): MailEmail {
  return {
    id: row.id as number,
    accountId: row.account_id as string,
    gmailId: row.gmail_id as string,
    messageId: row.message_id as string,
    threadId: row.thread_id as string,
    fromAddr: row.from_addr as string,
    fromName: row.from_name as string | undefined,
    toAddr: row.to_addr as string | undefined,
    subject: row.subject as string,
    bodySanitized: row.body_sanitized as string,
    summary: row.summary as string | undefined,
    category: row.category as MailEmail['category'],
    urgency: row.urgency as 0 | 1 | 2,
    injectionScore: row.injection_score as number,
    status: row.status as MailEmail['status'],
    hasAttachments: (row.has_attachments as number) === 1,
    receivedAt: row.received_at as number,
    fetchedAt: row.fetched_at as number,
    labels: row.labels ? JSON.parse(row.labels as string) as string[] : undefined,
  };
}

function rowToDraft(row: Record<string, unknown>): MailDraft {
  return {
    id: row.id as number,
    emailId: row.email_id as number,
    draftBody: row.draft_body as string,
    justification: row.justification as string | undefined,
    status: row.status as MailDraft['status'],
    createdAt: row.created_at as number,
  };
}
