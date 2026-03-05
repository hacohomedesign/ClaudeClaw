import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read token and chatId from .env (the daemon must be running)
function readEnv(): { token: string; chatId: string } {
  const envPath = resolve(__dirname, '..', '.env');
  const content = readFileSync(envPath, 'utf-8');
  const get = (key: string): string => {
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match?.[1]?.trim() ?? '';
  };
  return { token: get('DASHBOARD_TOKEN'), chatId: get('ALLOWED_CHAT_ID') };
}

const env = readEnv();

test.describe('Dashboard Chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/?token=${env.token}&chatId=${env.chatId}`);
    // Wait for dashboard to load
    await page.waitForSelector('#refresh-btn');
  });

  test('Chat FAB is visible', async ({ page }) => {
    const fab = page.locator('#chat-fab');
    await expect(fab).toBeVisible();
  });

  test('Opening chat shows overlay with header', async ({ page }) => {
    await page.click('#chat-fab');
    const overlay = page.locator('#chat-overlay');
    await expect(overlay).toHaveClass(/open/);
    const title = page.locator('.chat-header-title');
    await expect(title).toHaveText('RC1 Chat');
  });

  test('Chat input and send button are visible', async ({ page }) => {
    await page.click('#chat-fab');
    await expect(page.locator('#chat-input')).toBeVisible();
    await expect(page.locator('#chat-send-btn')).toBeVisible();
  });

  test('Closing chat hides overlay', async ({ page }) => {
    await page.click('#chat-fab');
    await expect(page.locator('#chat-overlay')).toHaveClass(/open/);
    // Click the close button
    await page.locator('#chat-overlay button:has-text("×")').click();
    await expect(page.locator('#chat-overlay')).not.toHaveClass(/open/);
  });

  test('SSE stream connects', async ({ page }) => {
    // Intercept the SSE endpoint
    const ssePromise = page.waitForRequest(
      (req) => req.url().includes('/api/chat/stream'),
    );
    await page.click('#chat-fab');
    const sseReq = await ssePromise;
    expect(sseReq.url()).toContain('/api/chat/stream');
  });

  test('History loads on chat open', async ({ page }) => {
    // Intercept history endpoint
    const historyPromise = page.waitForResponse(
      (res) => res.url().includes('/api/chat/history') && res.status() === 200,
    );
    await page.click('#chat-fab');
    const historyRes = await historyPromise;
    const body = await historyRes.json();
    expect(body).toHaveProperty('turns');
  });

  test('Telegram pill is visible in System Health', async ({ page }) => {
    const tgPill = page.locator('#tg-pill');
    await expect(tgPill).toBeVisible();
    await expect(tgPill).toHaveText('Telegram');
  });

  test('Progress bar appears on processing', async ({ page }) => {
    await page.click('#chat-fab');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as unknown as Record<string, () => void>).showTyping();
    });
    const bar = page.locator('#chat-progress-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveClass(/active/);
  });

  test('Progress bar shows tool label', async ({ page }) => {
    await page.click('#chat-fab');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as unknown as Record<string, (d: string) => void>).showProgress('Lecture fichier');
    });
    const label = page.locator('#chat-progress-label');
    await expect(label).toHaveText('Lecture fichier');
  });

  test('Progress bar hides after response', async ({ page }) => {
    await page.click('#chat-fab');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      (window as unknown as Record<string, () => void>).showTyping();
    });
    await expect(page.locator('#chat-progress-bar')).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as Record<string, () => void>).hideTyping();
    });
    await expect(page.locator('#chat-progress-bar')).not.toBeVisible();
  });

  test('Progress bar is fixed (not in messages)', async ({ page }) => {
    await page.click('#chat-fab');
    await page.waitForTimeout(500);
    // Verify that #chat-progress-bar is NOT a child of #chat-messages
    const isChild = await page.evaluate(() => {
      const bar = document.getElementById('chat-progress-bar');
      const messages = document.getElementById('chat-messages');
      return messages?.contains(bar) ?? false;
    });
    expect(isChild).toBe(false);
  });
});
