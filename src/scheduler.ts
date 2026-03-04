import { CronExpressionParser } from 'cron-parser';

import { ALLOWED_CHAT_ID } from './config.js';
import {
  getDueTasks,
  markTaskRunning,
  updateTaskAfterRun,
} from './db.js';
import { logger } from './logger.js';
import { runAgent } from './agent.js';
import { formatForTelegram } from './bot.js';

type Sender = (text: string) => Promise<void>;

let sender: Sender;

// In-memory guard: task IDs currently being executed.
// Prevents re-firing a long-running task on the next 60s tick before
// updateTaskAfterRun has had a chance to advance next_run in the DB.
const runningTaskIds = new Set<string>();

/**
 * Initialise the scheduler. Call once after the Telegram bot is ready.
 * @param send  Function that sends a message to the user's Telegram chat.
 */
export function initScheduler(send: Sender): void {
  if (!ALLOWED_CHAT_ID) {
    logger.warn('ALLOWED_CHAT_ID not set — scheduler will not send results');
  }
  sender = send;
  setInterval(() => void runDueTasks(), 60_000);
  logger.info('Scheduler started (checking every 60s)');
}

async function runDueTasks(): Promise<void> {
  const tasks = getDueTasks().filter((t) => !runningTaskIds.has(t.id));
  if (tasks.length === 0) return;

  logger.info({ count: tasks.length }, 'Running due scheduled tasks');

  for (const task of tasks) {
    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 60) }, 'Firing task');

    runningTaskIds.add(task.id);
    // Advance next_run in the DB immediately so the task won't be picked up
    // again by the next tick if the agent takes longer than 60 seconds.
    const nextRun = computeNextRun(task.schedule);
    markTaskRunning(task.id, nextRun);

    try {
      await sender(`Scheduled task running: "${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? '...' : ''}"`);

      // Run as a fresh agent call (no session — scheduled tasks are autonomous)
      const result = await runAgent(task.prompt, undefined, () => {});
      const text = result.text?.trim() || 'Task completed with no output.';

      await sender(formatForTelegram(text));

      updateTaskAfterRun(task.id, computeNextRun(task.schedule), text);

      logger.info({ taskId: task.id, nextRun }, 'Task complete, next run scheduled');
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Scheduled task failed');
      try {
        await sender(`Task failed: "${task.prompt.slice(0, 60)}..." — check logs.`);
      } catch {
        // ignore send failure
      }
    } finally {
      runningTaskIds.delete(task.id);
    }
  }
}

export function computeNextRun(cronExpression: string): number {
  const interval = CronExpressionParser.parse(cronExpression);
  return Math.floor(interval.next().getTime() / 1000);
}
