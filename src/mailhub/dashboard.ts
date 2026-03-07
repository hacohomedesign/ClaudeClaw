import { Hono } from 'hono';
import { getMailSummaryStats, getUnreadEmails, getEmailById, getEmailsByAccount, getPendingDrafts, updateEmailStatus, getAttachmentsByEmail } from './store.js';
import { MAIL_ACCOUNTS } from './accounts.js';
import { forceMailCheck } from './scheduler.js';
import type { MailEmail } from './types.js';

export function registerMailDashboardRoutes(app: Hono): void {

  // Mail summary — counters per account
  app.get('/api/mail/summary', (c) => {
    const stats = getMailSummaryStats();
    return c.json({ stats, accounts: MAIL_ACCOUNTS });
  });

  // Email list (filtered)
  app.get('/api/mail/emails', (c) => {
    const accountId = c.req.query('account');
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    let emails: MailEmail[];
    if (accountId) {
      emails = getEmailsByAccount(accountId, limit);
    } else {
      emails = getUnreadEmails();
    }

    if (status) {
      emails = emails.filter(e => e.status === status);
    }

    return c.json({ emails: emails.slice(0, limit) });
  });

  // Single email detail
  app.get('/api/mail/email/:id', (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const email = getEmailById(id);
    if (!email) return c.json({ error: 'Not found' }, 404);
    const attachments = getAttachmentsByEmail(id);
    return c.json({ email, attachments });
  });

  // Pending drafts
  app.get('/api/mail/drafts', (c) => {
    const drafts = getPendingDrafts();
    return c.json({ drafts });
  });

  // Actions (mark read/archive/etc)
  app.post('/api/mail/action', async (c) => {
    const body = await c.req.json<{ emailId: number; action: string }>();
    const { emailId, action } = body;

    const statusMap: Record<string, MailEmail['status']> = {
      read: 'read',
      archive: 'archived',
      unread: 'unread',
    };

    const newStatus = statusMap[action];
    if (!newStatus) return c.json({ error: 'Invalid action' }, 400);

    updateEmailStatus(emailId, newStatus);
    return c.json({ ok: true });
  });

  // Force mail check
  app.post('/api/mail/check', async (c) => {
    try {
      const result = await forceMailCheck();
      return c.json({ ok: true, result });
    } catch {
      return c.json({ ok: false, error: 'Check failed' }, 500);
    }
  });
}

// HTML section for the dashboard — a mail card to be inserted into the main dashboard
export function getMailDashboardSection(): string {
  return `
<!-- MailHub -->
<div id="mail-section" class="mt-5">
  <h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">MailHub</h2>
  <div class="card">
    <div class="flex justify-between items-center mb-3">
      <div class="flex items-center gap-2">
        <span class="text-lg">&#9993;</span>
        <span class="text-white font-semibold">Mail Overview</span>
      </div>
      <button onclick="checkMail()" id="mail-check-btn" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition">
        Check Now
      </button>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-3">
      <div class="text-center"><div class="stat-val" id="mail-total">-</div><div class="stat-label">Total</div></div>
      <div class="text-center"><div class="stat-val" id="mail-unread">-</div><div class="stat-label">Unread</div></div>
    </div>
    <div id="mail-accounts" class="space-y-1 mb-3"></div>
    <div id="mail-recent"></div>
  </div>
</div>`;
}

// JavaScript for the mail section (to be included in the dashboard HTML)
export function getMailDashboardScript(): string {
  return `
// ── MailHub ──────────────────────────────────────────────────────────
async function loadMailStats() {
  try {
    const data = await api('/api/mail/summary');
    document.getElementById('mail-total').textContent = data.stats.total;
    document.getElementById('mail-unread').textContent = data.stats.unread;

    const accountsEl = document.getElementById('mail-accounts');
    accountsEl.innerHTML = data.accounts
      .map(function(a) {
        const s = data.stats.byAccount[a.id] || { total: 0, unread: 0 };
        const dot = a.active ? '<span class="pill pill-active">ON</span>' : '<span class="pill pill-paused">OFF</span>';
        return '<div class="flex justify-between items-center text-sm py-1 border-b border-gray-800">' +
          '<span>' + dot + ' ' + escapeHtml(a.label) + '</span>' +
          '<span class="text-gray-400">' + s.unread + '/' + s.total + '</span>' +
        '</div>';
      }).join('');

    // Load recent unread
    const emailsData = await api('/api/mail/emails?status=unread&limit=5');
    const recentEl = document.getElementById('mail-recent');
    if (emailsData.emails.length === 0) {
      recentEl.innerHTML = '<div class="text-xs text-gray-600 text-center py-2">No unread emails</div>';
    } else {
      recentEl.innerHTML = emailsData.emails.map(function(e) {
        const urgencyBadge = e.urgency >= 2 ? '<span class="pill" style="background:#5c1a1a;color:#f87171">URGENT</span> ' :
                             e.urgency >= 1 ? '<span class="pill" style="background:#422006;color:#fbbf24">ACTION</span> ' : '';
        const date = new Date(e.receivedAt * 1000).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
        return '<div class="text-sm py-1 border-b border-gray-800">' +
          '<div class="flex justify-between">' +
            '<span class="text-white truncate" style="max-width:70%">' + urgencyBadge + escapeHtml(e.subject.slice(0,50)) + '</span>' +
            '<span class="text-gray-500 text-xs">' + date + '</span>' +
          '</div>' +
          '<div class="text-xs text-gray-500">' + escapeHtml(e.fromName || e.fromAddr) + '</div>' +
        '</div>';
      }).join('');
    }
  } catch (err) {
    console.error('Mail stats error:', err);
  }
}

async function checkMail() {
  const btn = document.getElementById('mail-check-btn');
  btn.textContent = 'Checking...';
  btn.disabled = true;
  try {
    if (TOKEN) {
      await fetch(BASE + '/api/mail/check?token=' + TOKEN, { method: 'POST' });
    } else {
      await fetch(BASE + '/api/mail/check', { method: 'POST', credentials: 'same-origin' });
    }
    await loadMailStats();
  } catch (err) {
    console.error('Mail check error:', err);
  }
  btn.textContent = 'Check Now';
  btn.disabled = false;
}

loadMailStats();
setInterval(loadMailStats, 300000);
`;
}
