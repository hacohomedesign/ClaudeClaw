import { Api, RawApi } from 'grammy';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getCookie, setCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import crypto from 'crypto';

import fs from 'fs';
import path from 'path';
import { AGENT_ID, ALLOWED_CHAT_ID, DASHBOARD_PORT, DASHBOARD_TOKEN, DASHBOARD_USER, DASHBOARD_PASSWORD, PROJECT_ROOT, STORE_DIR, WHATSAPP_ENABLED, SLACK_USER_TOKEN, CONTEXT_LIMIT } from './config.js';
import {
  getAllScheduledTasks,
  deleteScheduledTask,
  pauseScheduledTask,
  resumeScheduledTask,
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
  getHiveMindEntries,
  getAgentTokenStats,
  getAgentRecentConversation,
} from './db.js';
import { listAgentIds, loadAgentConfig } from './agent-config.js';
import { processMessageFromDashboard } from './bot.js';
import { getDashboardHtml } from './dashboard-html.js';
import { logger } from './logger.js';
import { getTelegramConnected, getBotInfo, chatEvents, getIsProcessing, abortActiveQuery, ChatEvent } from './state.js';

export function startDashboard(botApi?: Api<RawApi>): void {
  if (!DASHBOARD_TOKEN) {
    logger.info('DASHBOARD_TOKEN not set, dashboard disabled');
    return;
  }

  const app = new Hono();

  // CORS headers for cross-origin access (Cloudflare tunnel, mobile browsers)
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Global error handler — prevents unhandled throws from killing the server
  app.onError((err, c) => {
    logger.error({ err: err.message }, 'Dashboard request error');
    return c.json({ error: 'Internal server error' }, 500);
  });

  // Session secret derived from dashboard token (stable across restarts)
  const sessionSecret = crypto.createHash('sha256').update(DASHBOARD_TOKEN + ':session').digest('hex');

  function makeSessionToken(): string {
    const payload = `${DASHBOARD_USER}:${Date.now()}`;
    const sig = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64')}.${sig}`;
  }

  function verifySessionToken(token: string): boolean {
    const [b64, sig] = token.split('.');
    if (!b64 || !sig) return false;
    const expected = crypto.createHmac('sha256', sessionSecret).update(Buffer.from(b64, 'base64').toString()).digest('hex');
    return sig === expected;
  }

  // Login page HTML
  const loginPageHtml = (error = '') => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClaudeClaw — Login</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
  .login-box { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 2rem; width: 320px; }
  h1 { font-size: 1.3rem; margin: 0 0 1.5rem; text-align: center; }
  label { display: block; font-size: 0.85rem; color: #999; margin-bottom: 0.3rem; }
  input { width: 100%; padding: 0.6rem; background: #0a0a0a; border: 1px solid #444; border-radius: 6px; color: #e0e0e0; font-size: 0.95rem; margin-bottom: 1rem; box-sizing: border-box; }
  button { width: 100%; padding: 0.7rem; background: #2563eb; border: none; border-radius: 6px; color: white; font-size: 1rem; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  .error { color: #ef4444; font-size: 0.85rem; text-align: center; margin-bottom: 1rem; }
</style></head><body>
<div class="login-box">
  <h1>ClaudeClaw Dashboard</h1>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST" action="/login">
    <label>Utilisateur</label><input name="username" type="text" autofocus required>
    <label>Mot de passe</label><input name="password" type="password" required>
    <input type="hidden" name="token" value="">
    <button type="submit">Connexion</button>
  </form>
  <script>document.querySelector('input[name=token]').value=new URLSearchParams(location.search).get('token')||'';</script>
</div></body></html>`;

  // Login POST handler
  app.post('/login', async (c) => {
    const body = await c.req.parseBody();
    const username = String(body['username'] || '');
    const password = String(body['password'] || '');
    const token = String(body['token'] || '');

    if (!token || token !== DASHBOARD_TOKEN) {
      return c.html(loginPageHtml('Token invalide'), 401);
    }
    if (!DASHBOARD_USER || !DASHBOARD_PASSWORD || username !== DASHBOARD_USER || password !== DASHBOARD_PASSWORD) {
      return c.html(loginPageHtml('Identifiants incorrects'), 401);
    }

    setCookie(c, 'claw_session', makeSessionToken(), {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 7 * 24 * 3600, // 7 days
      path: '/',
    });

    return c.redirect(`/?token=${encodeURIComponent(token)}`);
  });

  // Auth middleware: token required + session cookie (if user/password configured)
  app.use('*', async (c, next) => {
    // Always require token
    const token = c.req.query('token');
    if (!DASHBOARD_TOKEN || !token || token !== DASHBOARD_TOKEN) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // If user/password auth is configured, also require valid session cookie
    if (DASHBOARD_USER && DASHBOARD_PASSWORD) {
      const session = getCookie(c, 'claw_session');
      if (!session || !verifySessionToken(session)) {
        return c.html(loginPageHtml(), 200);
      }
    }

    await next();
  });

  // Serve dashboard HTML
  app.get('/', (c) => {
    const chatId = c.req.query('chatId') || '';
    return c.html(getDashboardHtml(DASHBOARD_TOKEN, chatId));
  });

  // Scheduled tasks
  app.get('/api/tasks', (c) => {
    const tasks = getAllScheduledTasks();
    return c.json({ tasks });
  });

  // Delete a scheduled task
  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    deleteScheduledTask(id);
    return c.json({ ok: true });
  });

  // Pause a scheduled task
  app.post('/api/tasks/:id/pause', (c) => {
    const id = c.req.param('id');
    pauseScheduledTask(id);
    return c.json({ ok: true });
  });

  // Resume a scheduled task
  app.post('/api/tasks/:id/resume', (c) => {
    const id = c.req.param('id');
    resumeScheduledTask(id);
    return c.json({ ok: true });
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

  // ── Agent endpoints ──────────────────────────────────────────────────

  // List all configured agents with status
  app.get('/api/agents', (c) => {
    const agentIds = listAgentIds();
    const agents = agentIds.map((id) => {
      try {
        const config = loadAgentConfig(id);
        // Check if agent process is alive via PID file
        const pidFile = path.join(STORE_DIR, `agent-${id}.pid`);
        let running = false;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            process.kill(pid, 0); // signal 0 = check if alive
            running = true;
          } catch { /* process not running */ }
        }
        const stats = getAgentTokenStats(id);
        return {
          id,
          name: config.name,
          description: config.description,
          model: config.model ?? 'claude-opus-4-6',
          running,
          todayTurns: stats.todayTurns,
          todayCost: stats.todayCost,
        };
      } catch {
        return { id, name: id, description: '', model: 'unknown', running: false, todayTurns: 0, todayCost: 0 };
      }
    });

    // Include main bot too
    const mainPidFile = path.join(STORE_DIR, 'claudeclaw.pid');
    let mainRunning = false;
    if (fs.existsSync(mainPidFile)) {
      try {
        const pid = parseInt(fs.readFileSync(mainPidFile, 'utf-8').trim(), 10);
        process.kill(pid, 0);
        mainRunning = true;
      } catch { /* not running */ }
    }
    const mainStats = getAgentTokenStats('main');
    const allAgents = [
      { id: 'main', name: 'Main', description: 'Primary ClaudeClaw bot', model: 'claude-opus-4-6', running: mainRunning, todayTurns: mainStats.todayTurns, todayCost: mainStats.todayCost },
      ...agents,
    ];

    return c.json({ agents: allAgents });
  });

  // Agent-specific recent conversation
  app.get('/api/agents/:id/conversation', (c) => {
    const agentId = c.req.param('id');
    const chatId = c.req.query('chatId') || ALLOWED_CHAT_ID || '';
    const limit = parseInt(c.req.query('limit') || '4', 10);
    const turns = getAgentRecentConversation(agentId, chatId, limit);
    return c.json({ turns });
  });

  // Agent-specific tasks
  app.get('/api/agents/:id/tasks', (c) => {
    const agentId = c.req.param('id');
    const tasks = getAllScheduledTasks(agentId);
    return c.json({ tasks });
  });

  // Agent-specific token stats
  app.get('/api/agents/:id/tokens', (c) => {
    const agentId = c.req.param('id');
    const stats = getAgentTokenStats(agentId);
    return c.json(stats);
  });

  // Hive mind feed
  app.get('/api/hive-mind', (c) => {
    const agentId = c.req.query('agent');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const entries = getHiveMindEntries(limit, agentId || undefined);
    return c.json({ entries });
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

  serve({ fetch: app.fetch, port: DASHBOARD_PORT }, () => {
    logger.info({ port: DASHBOARD_PORT }, 'Dashboard server running');
  });
}
