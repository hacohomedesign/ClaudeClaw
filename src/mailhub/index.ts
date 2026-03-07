import { initEmbeddingsPool } from './embeddings.js';
import { initMailHubScheduler } from './scheduler.js';
import { logger } from '../logger.js';

export async function initMailHub(notifyFn?: (text: string) => void): Promise<void> {
  logger.info('Initializing MailHub...');
  initEmbeddingsPool();
  if (notifyFn) {
    initMailHubScheduler(notifyFn);
  }
  logger.info('MailHub initialized');
}

export { MAIL_ACCOUNTS, getActiveAccounts, getAccountById } from './accounts.js';
export { processRawEmail, fetchViaGog, buildMcpFetchPrompt } from './fetcher.js';
export { sanitizeEmailBody } from './sanitizer.js';
export { classifyAttachment, uploadAttachmentToDrive } from './attachments.js';
export { classifyEmail } from './classifier.js';
export { summarizeEmail } from './summarizer.js';
export { embedText, storeEmbedding, searchSimilar } from './embeddings.js';
export { buildDigest, reconcileDigest } from './digest.js';
export { generateDraft } from './drafter.js';
export { forceMailCheck, stopMailHubScheduler } from './scheduler.js';
export * from './store.js';
export * from './types.js';
