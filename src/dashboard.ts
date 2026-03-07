import crypto from 'crypto';
import { Api, RawApi } from 'grammy';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';

import { ALLOWED_CHAT_ID, DASHBOARD_PORT, DASHBOARD_TOKEN, DASHBOARD_USER, DASHBOARD_PASSWORD, DASHBOARD_COOKIE_SECRET, WHATSAPP_ENABLED, SLACK_USER_TOKEN, CONTEXT_LIMIT } from './config.js';
import {
  getAllScheduledTasks,
  getConversationPage,
  getDashboardMemoryStats,
  getDashboardLowSalienceMemories,
  getDashboardTopAccessedMemories,
  getDashboardMemoryTimeline,
  getDashboardTokenStats,
  getDashboardCostTimeline,
  getDashboardRecentTokenUsage,
  getDashboardMemoriesBySector,
  getSession,
  getSessionTokenUsage,
} from './db.js';
import { processMessageFromDashboard } from './bot.js';
import { getDashboardHtml, getLoginHtml } from './dashboard-html.js';
import { logger } from './logger.js';
import { getTelegramConnected, getBotInfo, chatEvents, getIsProcessing, abortActiveQuery, ChatEvent } from './state.js';
import { registerMailDashboardRoutes } from './mailhub/dashboard.js';

// ── Session cookie helpers ──────────────────────────────────────────────

const COOKIE_NAME = 'claw_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function makeSessionCookie(user: string): string {
  const expiry = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${user}.${expiry}`;
  const hmac = crypto.createHmac('sha256', DASHBOARD_COOKIE_SECRET).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

function verifySessionCookie(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [user, expiryStr, hmac] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (isNaN(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', DASHBOARD_COOKIE_SECRET).update(`${user}.${expiryStr}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

function verifyPassword(input: string): boolean {
  const inputBuf = Buffer.from(input, 'utf8');
  const expectedBuf = Buffer.from(DASHBOARD_PASSWORD, 'utf8');
  if (inputBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(inputBuf, expectedBuf);
}

export function startDashboard(botApi?: Api<RawApi>): void {
  if (!DASHBOARD_TOKEN) {
    logger.info('DASHBOARD_TOKEN not set, dashboard disabled');
    return;
  }

  const app = new Hono();

  // ── Login / Logout routes (no auth required) ─────────────────────────

  app.get('/login', (c) => {
    return c.html(getLoginHtml());
  });

  app.post('/login', async (c) => {
    const body = await c.req.parseBody();
    const user = String(body['username'] || '');
    const pass = String(body['password'] || '');

    if (!DASHBOARD_USER || !DASHBOARD_PASSWORD) {
      return c.html(getLoginHtml('Login is not configured (missing DASHBOARD_USER/DASHBOARD_PASSWORD)'));
    }

    if (user === DASHBOARD_USER && verifyPassword(pass)) {
      const cookieValue = makeSessionCookie(user);
      setCookie(c, COOKIE_NAME, cookieValue, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        maxAge: SESSION_MAX_AGE,
      });
      return c.redirect('/');
    }

    return c.html(getLoginHtml('Invalid username or password'));
  });

  app.get('/logout', (c) => {
    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return c.redirect('/login');
  });

  // ── Auth middleware (cookie + token fallback) ─────────────────────────

  app.use('*', async (c, next) => {
    // Check 1: session cookie
    const cookie = getCookie(c, COOKIE_NAME);
    if (cookie && verifySessionCookie(cookie)) {
      await next();
      return;
    }

    // Check 2: token query param (retrocompat)
    const token = c.req.query('token');
    if (token === DASHBOARD_TOKEN) {
      await next();
      return;
    }

    // Not authenticated — redirect HTML requests to login, 401 for API
    const path = new URL(c.req.url).pathname;
    if (path.startsWith('/api/')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return c.redirect('/login');
  });

  // Serve dashboard HTML
  app.get('/', (c) => {
    // If authenticated via cookie (no token in URL), pass empty token so frontend uses cookies
    const token = c.req.query('token') || '';
    const chatId = c.req.query('chatId') || '';
    return c.html(getDashboardHtml(token, chatId));
  });

  // Scheduled tasks
  app.get('/api/tasks', (c) => {
    const tasks = getAllScheduledTasks();
    return c.json({ tasks });
  });

  // Memory stats
  app.get('/api/memories', (c) => {
    const chatId = c.req.query('chatId') || '';
    const stats = getDashboardMemoryStats(chatId);
    const fading = getDashboardLowSalienceMemories(chatId, 10);
    const topAccessed = getDashboardTopAccessedMemories(chatId, 5);
    const timeline = getDashboardMemoryTimeline(chatId, 30);
    return c.json({ stats, fading, topAccessed, timeline });
  });

  // Memory list by sector (for drill-down)
  app.get('/api/memories/list', (c) => {
    const chatId = c.req.query('chatId') || '';
    const sector = c.req.query('sector') || 'semantic';
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const result = getDashboardMemoriesBySector(chatId, sector, limit, offset);
    return c.json(result);
  });

  // System health
  app.get('/api/health', (c) => {
    const chatId = c.req.query('chatId') || '';
    const sessionId = getSession(chatId);
    let contextPct = 0;
    let turns = 0;
    let compactions = 0;
    let sessionAge = '-';

    if (sessionId) {
      const summary = getSessionTokenUsage(sessionId);
      if (summary) {
        turns = summary.turns;
        compactions = summary.compactions;
        const contextTokens = (summary.lastContextTokens || 0) + (summary.lastCacheRead || 0);
        contextPct = contextTokens > 0 ? Math.round((contextTokens / CONTEXT_LIMIT) * 100) : 0;
        const ageSec = Math.floor(Date.now() / 1000) - summary.firstTurnAt;
        if (ageSec < 3600) sessionAge = Math.floor(ageSec / 60) + 'm';
        else if (ageSec < 86400) sessionAge = Math.floor(ageSec / 3600) + 'h';
        else sessionAge = Math.floor(ageSec / 86400) + 'd';
      }
    }

    return c.json({
      contextPct,
      turns,
      compactions,
      sessionAge,
      telegramConnected: getTelegramConnected(),
      waConnected: WHATSAPP_ENABLED,
      slackConnected: !!SLACK_USER_TOKEN,
    });
  });

  // Token / cost stats
  app.get('/api/tokens', (c) => {
    const chatId = c.req.query('chatId') || '';
    const stats = getDashboardTokenStats(chatId);
    const costTimeline = getDashboardCostTimeline(chatId, 30);
    const recentUsage = getDashboardRecentTokenUsage(chatId, 20);
    return c.json({ stats, costTimeline, recentUsage });
  });

  // Bot info (name, PID, chatId) — reads dynamically from state
  app.get('/api/info', (c) => {
    const chatId = c.req.query('chatId') || '';
    const info = getBotInfo();
    return c.json({
      botName: info.name || 'ClaudeClaw',
      botUsername: info.username || '',
      pid: process.pid,
      chatId: chatId || null,
    });
  });

  // ── Chat endpoints ─────────────────────────────────────────────────

  // SSE stream for real-time chat updates
  app.get('/api/chat/stream', (c) => {
    return streamSSE(c, async (stream) => {
      // Send initial processing state
      const state = getIsProcessing();
      await stream.writeSSE({
        event: 'processing',
        data: JSON.stringify({ processing: state.processing, chatId: state.chatId }),
      });

      // Forward chat events to SSE client
      const handler = async (event: ChatEvent) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        } catch {
          // Client disconnected
        }
      };

      chatEvents.on('chat', handler);

      // Keepalive ping every 30s
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ event: 'ping', data: '' });
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // Wait until the client disconnects
      try {
        await new Promise<void>((_, reject) => {
          stream.onAbort(() => reject(new Error('aborted')));
        });
      } catch {
        // Expected: client disconnected
      } finally {
        clearInterval(pingInterval);
        chatEvents.off('chat', handler);
      }
    });
  });

  // Chat history (paginated)
  app.get('/api/chat/history', (c) => {
    const chatId = c.req.query('chatId') || '';
    if (!chatId) return c.json({ error: 'chatId required' }, 400);
    const limit = parseInt(c.req.query('limit') || '40', 10);
    const beforeId = c.req.query('beforeId');
    const turns = getConversationPage(chatId, limit, beforeId ? parseInt(beforeId, 10) : undefined);
    return c.json({ turns });
  });

  // Send message from dashboard
  app.post('/api/chat/send', async (c) => {
    if (!botApi) return c.json({ error: 'Bot API not available' }, 503);
    const body = await c.req.json<{ message?: string }>();
    const message = body?.message?.trim();
    if (!message) return c.json({ error: 'message required' }, 400);

    // Fire-and-forget: response comes via SSE
    void processMessageFromDashboard(botApi, message);
    return c.json({ ok: true });
  });

  // Abort current processing
  app.post('/api/chat/abort', (c) => {
    const { chatId } = getIsProcessing();
    if (!chatId) return c.json({ ok: false, reason: 'not_processing' });
    const aborted = abortActiveQuery(chatId);
    return c.json({ ok: aborted });
  });

  // ── Mail routes ──────────────────────────────────────────────────────
  registerMailDashboardRoutes(app);

  serve({ fetch: app.fetch, port: DASHBOARD_PORT }, () => {
    logger.info({ port: DASHBOARD_PORT }, 'Dashboard server running');
  });
}
