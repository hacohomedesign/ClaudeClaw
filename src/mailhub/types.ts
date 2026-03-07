// mailhub/types.ts — Shared interfaces for the MailHub module

export interface MailAccount {
  id: string; // '360sc', 'gs1', 'personal', 'rorworld', 'sci'
  label: string;
  email: string;
  fetchVia: 'mcp' | 'gog';
  gogAccount?: string;
  gogClient?: string;
  active: boolean;
  lastPoll?: number;
}

export interface MailEmail {
  id?: number;
  accountId: string;
  gmailId: string;
  messageId: string; // RFC Message-ID (dedup key)
  threadId: string;
  fromAddr: string;
  fromName?: string;
  toAddr?: string;
  subject: string;
  bodySanitized: string;
  summary?: string;
  category?: 'action' | 'info' | 'urgent' | 'newsletter' | 'admin' | 'social';
  urgency: 0 | 1 | 2;
  injectionScore: number;
  status: 'unread' | 'read' | 'replied' | 'archived' | 'drafted';
  hasAttachments: boolean;
  receivedAt: number;
  fetchedAt: number;
  labels?: string[];
}

export interface MailThread {
  threadId: string;
  accountId: string;
  subject: string;
  participants?: string[];
  messageCount: number;
  lastMessageAt: number;
  status: 'active' | 'closed';
}

export interface MailAttachment {
  id?: number;
  emailId: number;
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  gmailAttId?: string;
  riskLevel: 'safe' | 'caution' | 'blocked';
  driveFileId?: string;
  driveUrl?: string;
}

export interface MailDigest {
  id?: number;
  date: string; // YYYY-MM-DD
  cycle: number;
  emailsIncluded: number[];
  obsidianPath?: string;
  telegramSent: boolean;
  createdAt: number;
}

export interface MailDraft {
  id?: number;
  emailId: number;
  draftBody: string;
  justification?: string;
  status: 'proposed' | 'approved' | 'sent' | 'discarded';
  createdAt: number;
}

export interface SanitizeResult {
  sanitized: string;
  injectionScore: number;
}

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  riskLevel: 'safe' | 'caution' | 'blocked';
}
