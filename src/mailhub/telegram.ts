import { Bot } from 'grammy';
import { forceMailCheck } from './scheduler.js';
import { getUnreadEmails, getEmailById, getMailSummaryStats, updateEmailStatus, getEmailsByThread } from './store.js';
import { searchSimilar } from './embeddings.js';
import { generateDraft } from './drafter.js';
import { MAIL_ACCOUNTS } from './accounts.js';
import { logger } from '../logger.js';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function registerMailCommands(bot: Bot): void {

  // /mail — Daily summary
  bot.command('mail', async (ctx) => {
    const stats = getMailSummaryStats();
    let msg = `<b>Mail Summary</b>\n`;
    msg += `Total: ${stats.total} | Unread: ${stats.unread}\n\n`;

    for (const account of MAIL_ACCOUNTS) {
      const s = stats.byAccount[account.id];
      if (s) {
        msg += `<b>${escapeHtml(account.label)}</b>: ${s.total} total, ${s.unread} unread\n`;
      }
    }

    const urgent = getUnreadEmails().filter(e => e.urgency >= 1);
    if (urgent.length > 0) {
      msg += `\n<b>Urgent/Action:</b>\n`;
      for (const e of urgent.slice(0, 5)) {
        msg += `- ${escapeHtml(e.subject.slice(0, 60))} (${escapeHtml(e.fromName || e.fromAddr)})\n`;
      }
    }

    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  // /mailcheck — Force immediate poll
  bot.command('mailcheck', async (ctx) => {
    await ctx.reply('Checking mail...');
    try {
      const result = await forceMailCheck();
      await ctx.reply(`<b>Mail check complete</b>\n${escapeHtml(result)}`, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ err }, 'Mail check failed');
      await ctx.reply('Mail check failed. See logs.');
    }
  });

  // /maildraft <email_id> [instructions] — Generate draft
  bot.command('maildraft', async (ctx) => {
    const args = ctx.match?.toString().trim() || '';
    const parts = args.split(/\s+/);
    const emailId = parseInt(parts[0], 10);
    const instructions = parts.slice(1).join(' ') || undefined;

    if (isNaN(emailId)) {
      await ctx.reply('Usage: /maildraft <email_id> [instructions]');
      return;
    }

    await ctx.reply('Generating draft...');
    const draft = await generateDraft(emailId, instructions);
    if (draft) {
      let msg = `<b>Draft for email #${emailId}</b>\n\n`;
      msg += `<b>Strategy:</b> ${escapeHtml(draft.justification)}\n\n`;
      msg += `<b>Draft:</b>\n<pre>${escapeHtml(draft.draftBody.slice(0, 3000))}</pre>`;
      await ctx.reply(msg, { parse_mode: 'HTML' });
    } else {
      await ctx.reply('Failed to generate draft.');
    }
  });

  // /mailsearch <query> — Semantic search
  bot.command('mailsearch', async (ctx) => {
    const query = ctx.match?.toString().trim() || '';
    if (!query) {
      await ctx.reply('Usage: /mailsearch <query>');
      return;
    }

    const results = await searchSimilar(query, 5);
    if (results.length === 0) {
      await ctx.reply('No results found.');
      return;
    }

    let msg = `<b>Search results for "${escapeHtml(query)}"</b>\n\n`;
    for (const r of results) {
      const email = getEmailById(r.emailId);
      if (email) {
        msg += `<b>#${email.id}</b> ${escapeHtml(email.subject.slice(0, 50))}\n`;
        msg += `  From: ${escapeHtml(email.fromName || email.fromAddr)} | ${(r.similarity * 100).toFixed(0)}% match\n`;
        if (email.summary) msg += `  ${escapeHtml(email.summary.slice(0, 100))}\n`;
        msg += '\n';
      }
    }

    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  // /mailarchive <email_id> — Archive email
  bot.command('mailarchive', async (ctx) => {
    const emailId = parseInt(ctx.match?.toString().trim() || '', 10);
    if (isNaN(emailId)) {
      await ctx.reply('Usage: /mailarchive <email_id>');
      return;
    }
    const email = getEmailById(emailId);
    if (!email) {
      await ctx.reply('Email not found.');
      return;
    }
    updateEmailStatus(emailId, 'archived');
    await ctx.reply(`Archived: ${escapeHtml(email.subject.slice(0, 60))}`);
  });

  // /mailthread <email_id> — Show thread
  bot.command('mailthread', async (ctx) => {
    const emailId = parseInt(ctx.match?.toString().trim() || '', 10);
    if (isNaN(emailId)) {
      await ctx.reply('Usage: /mailthread <email_id>');
      return;
    }
    const email = getEmailById(emailId);
    if (!email) {
      await ctx.reply('Email not found.');
      return;
    }
    const thread = getEmailsByThread(email.threadId);
    let msg = `<b>Thread: ${escapeHtml(email.subject.slice(0, 50))}</b>\n${thread.length} messages\n\n`;
    for (const e of thread.sort((a, b) => a.receivedAt - b.receivedAt)) {
      const date = new Date(e.receivedAt * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      msg += `<b>${escapeHtml(e.fromName || e.fromAddr)}</b> (${date})\n`;
      msg += `${escapeHtml((e.summary || e.bodySanitized.slice(0, 150)))}\n\n`;
    }
    await ctx.reply(msg.slice(0, 4000), { parse_mode: 'HTML' });
  });
}
