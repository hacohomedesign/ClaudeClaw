import { getActiveAccounts } from './accounts.js';
import { buildMcpFetchPrompt, processRawEmail, type RawEmailData } from './fetcher.js';
import { buildDigest } from './digest.js';
import { MAILHUB_POLL_INTERVAL } from '../config.js';
import { runAgent } from '../agent.js';
import { logger } from '../logger.js';

type NotifyFn = (text: string) => void;

let pollInterval: ReturnType<typeof setInterval> | null = null;
let notifyFn: NotifyFn | null = null;

export function initMailHubScheduler(notify: NotifyFn): void {
  notifyFn = notify;
  // Initial check after 30s delay (let bot fully start)
  setTimeout(() => void runMailCycle(), 30_000);
  // Then poll at configured interval (default 1h)
  pollInterval = setInterval(() => void runMailCycle(), MAILHUB_POLL_INTERVAL);
  logger.info({ intervalMs: MAILHUB_POLL_INTERVAL }, 'MailHub scheduler started');
}

export async function forceMailCheck(): Promise<string> {
  return runMailCycle();
}

async function runMailCycle(): Promise<string> {
  const accounts = getActiveAccounts();
  let totalNew = 0;
  const results: string[] = [];

  for (const account of accounts) {
    try {
      if (account.fetchVia === 'mcp') {
        // Use runAgent to execute MCP fetch
        const prompt = buildMcpFetchPrompt(account);
        const result = await runAgent(prompt, undefined, () => {}, undefined, 'claude-haiku-4-5');

        if (result.text) {
          // Parse the JSON array from the agent's response
          const jsonMatch = result.text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            try {
              const emails: RawEmailData[] = JSON.parse(jsonMatch[0]);
              let accountNew = 0;
              for (const raw of emails) {
                const id = await processRawEmail(account.id, raw);
                if (id !== null) {
                  totalNew++;
                  accountNew++;
                }
              }
              results.push(`${account.label}: ${emails.length} fetched, ${accountNew} new`);
            } catch {
              results.push(`${account.label}: parse error`);
            }
          } else {
            results.push(`${account.label}: no emails`);
          }
        }
      }
      // gog accounts skipped for now (active: false)
    } catch (err) {
      logger.error({ err, accountId: account.id }, 'Mail fetch failed');
      results.push(`${account.label}: error`);
    }
  }

  // Build/update digest
  if (totalNew > 0) {
    try {
      await buildDigest();
    } catch (err) {
      logger.error({ err }, 'Digest build failed');
    }
  }

  const summary = `Mail check: ${totalNew} new emails. ${results.join(' | ')}`;
  if (notifyFn && totalNew > 0) {
    notifyFn(`<b>MailHub</b>\n${summary}`);
  }

  logger.info({ totalNew }, summary);
  return summary;
}

export function stopMailHubScheduler(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
