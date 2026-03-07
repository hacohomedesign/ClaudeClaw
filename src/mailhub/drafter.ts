import { runAgent } from '../agent.js';
import { getEmailById, getEmailsByThread, insertDraft } from './store.js';
import { logger } from '../logger.js';

export async function generateDraft(emailId: number, userInstructions?: string): Promise<{ draftBody: string; justification: string } | null> {
  const email = getEmailById(emailId);
  if (!email) {
    logger.error({ emailId }, 'Email not found for drafting');
    return null;
  }

  // Get thread context
  const threadEmails = getEmailsByThread(email.threadId);
  const threadContext = threadEmails
    .sort((a, b) => a.receivedAt - b.receivedAt)
    .map(e => `From: ${e.fromName || e.fromAddr}\nDate: ${new Date(e.receivedAt * 1000).toISOString()}\nSubject: ${e.subject}\n\n${e.bodySanitized.slice(0, 1000)}`)
    .join('\n---\n');

  const prompt = `Generate a professional email reply draft for Rolland MELET.

Context:
- Rolland is a professional working in standards/construction sector (GS1 France) and manages personal/business communications
- Reply should match the language of the original email (French or English)
- Be professional but friendly

${userInstructions ? `User instructions: ${userInstructions}\n` : ''}
Thread history:
${threadContext}

Latest email to reply to:
From: ${email.fromName || email.fromAddr} <${email.fromAddr}>
Subject: ${email.subject}
Date: ${new Date(email.receivedAt * 1000).toISOString()}

Body:
${email.bodySanitized.slice(0, 3000)}

Please provide:
1. JUSTIFICATION: A brief explanation of your reply strategy (1-2 sentences)
2. DRAFT: The full email reply text (ready to copy-paste)

Format your response exactly as:
JUSTIFICATION: ...
---DRAFT---
...`;

  try {
    const result = await runAgent(prompt, undefined, () => {});
    if (!result.text) return null;

    const draftMatch = result.text.match(/---DRAFT---\s*([\s\S]+)/);
    const justMatch = result.text.match(/JUSTIFICATION:\s*(.*?)(?:\n|---DRAFT---)/s);

    const draftBody = draftMatch?.[1]?.trim() || result.text;
    const justification = justMatch?.[1]?.trim() || 'Auto-generated reply';

    // Store in DB
    insertDraft({
      emailId,
      draftBody,
      justification,
      status: 'proposed',
      createdAt: Math.floor(Date.now() / 1000),
    });

    logger.info({ emailId, subject: email.subject.slice(0, 40) }, 'Draft generated');
    return { draftBody, justification };
  } catch (err) {
    logger.error({ err, emailId }, 'Draft generation failed');
    return null;
  }
}
