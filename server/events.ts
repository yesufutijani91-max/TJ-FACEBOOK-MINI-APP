import type { Response } from 'express';

export type EventPayload =
  | { type: 'message'; conversationId: string; message: unknown }
  | { type: 'typing'; conversationId: string; userId: string }
  | { type: 'notification'; notification: unknown }
  | { type: 'read'; conversationId: string; userId: string }
  | { type: 'ping'; at: string };

interface Client {
  id: string;
  userId: string;
  res: Response;
}

/**
 * Server-sent events hub. Each signed-in user can hold several streams
 * (phone, desktop) and receives their own realtime updates.
 */
class EventHub {
  private clients = new Map<string, Client>();

  add(userId: string, res: Response): string {
    const id = `${userId}:${Math.random().toString(36).slice(2)}`;
    this.clients.set(id, { id, userId, res });
    return id;
  }

  remove(id: string) {
    this.clients.delete(id);
  }

  publish(userIds: string[], payload: EventPayload) {
    const targets = new Set(userIds);
    for (const client of this.clients.values()) {
      if (!targets.has(client.userId)) continue;
      try {
        client.res.write(`event: ${payload.type}\n`);
        client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  get size() {
    return this.clients.size;
  }
}

export const events = new EventHub();
