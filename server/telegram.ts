import { config, telegramConfigured } from './config.js';

interface QueueItem {
  chatId: string;
  text: string;
  attempts: number;
}

const queue: QueueItem[] = [];
let draining = false;

const API_BASE = () => `https://api.telegram.org/bot${config.telegramBotToken}`;

/**
 * Sends a Telegram bot message to a user who started the bot. Notifications are
 * queued and retried so the API never blocks on Telegram.
 */
export function queueTelegramMessage(chatId: string | null | undefined, text: string) {
  if (!telegramConfigured || !chatId) return;
  queue.push({ chatId, text, attempts: 0 });
  void drain();
}

async function drain() {
  if (draining || !telegramConfigured) return;
  draining = true;
  try {
    while (queue.length) {
      const item = queue.shift()!;
      try {
        const response = await fetch(`${API_BASE()}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: item.chatId,
            text: item.text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          // 403 = the user never started the bot; drop silently.
          if (response.status === 403 || response.status === 400) {
            console.warn('[telegram] message skipped', response.status, body.slice(0, 160));
          } else if (item.attempts < 2) {
            item.attempts += 1;
            queue.push(item);
          }
        }
      } catch (error) {
        if (item.attempts < 2) {
          item.attempts += 1;
          queue.push(item);
        } else {
          console.warn('[telegram] send failed', (error as Error).message);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  } finally {
    draining = false;
  }
}

/** Bot identity lookup used by the client to build the Mini App link. */
let cachedBotUsername: string | null = config.telegramBotUsername || null;

export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername || !telegramConfigured) return cachedBotUsername;
  try {
    const response = await fetch(`${API_BASE()}/getMe`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok: boolean; result?: { username?: string } };
    cachedBotUsername = payload.result?.username ?? null;
    return cachedBotUsername;
  } catch {
    return null;
  }
}
