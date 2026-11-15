import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { User } from '../shared/types.js';
import { config, guestLoginEnabled, sessionSecret, telegramConfigured } from './config.js';
import type { Store } from './store/types.js';

export interface TelegramUserPayload {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
  isPremium?: boolean;
}

export interface SessionPayload {
  uid: string;
  exp: number;
  iat: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      session?: SessionPayload;
    }
  }
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (input: string) =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** Signs a compact session token: payload.signature */
export function signSession(userId: string): { token: string; expiresAt: string } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + config.sessionTtlDays * 86_400;
  const payload: SessionPayload = { uid: userId, iat: issuedAt, exp };
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  return {
    token: `${body}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body)) as SessionPayload;
    if (!payload.uid || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Validates Telegram WebApp initData exactly as documented for Mini Apps:
 * HMAC-SHA256 over the alphabetically sorted key=value pairs, keyed with
 * HMAC-SHA256("WebAppData", bot_token).
 */
export function validateTelegramInitData(initData: string): TelegramUserPayload | null {
  if (!telegramConfigured || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  const entries: [string, string][] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash' || key === 'signature') continue;
    entries.push([key, value]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.telegramBotToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const provided = Buffer.from(hash, 'hex');
  const expected = Buffer.from(computed, 'hex');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  const authDate = Number.parseInt(params.get('auth_date') ?? '0', 10);
  if (!authDate) return null;
  const ageSeconds = Math.abs(Date.now() / 1000 - authDate);
  if (ageSeconds > config.telegramInitDataMaxAgeSec) return null;

  const rawUser = params.get('user');
  if (!rawUser) return null;
  try {
    const parsed = JSON.parse(rawUser) as {
      id: number | string;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
      language_code?: string;
      is_premium?: boolean;
    };
    if (!parsed?.id) return null;
    return {
      id: String(parsed.id),
      firstName: parsed.first_name?.trim() || 'Telegram user',
      lastName: parsed.last_name?.trim(),
      username: parsed.username,
      photoUrl: parsed.photo_url,
      languageCode: parsed.language_code,
      isPremium: Boolean(parsed.is_premium),
    };
  } catch {
    return null;
  }
}

export function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(/(?:^|;\s*)tj_session=([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return null;
}

export function sessionCookie(token: string, expiresAt: string) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  return `tj_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie() {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  return `tj_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function attachUser(store: Store) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = readToken(req);
      const session = verifySession(token);
      if (session) {
        const user = await store.getUser(session.uid);
        if (user && !user.suspended) {
          req.user = user;
          req.session = session;
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in to continue', code: 'unauthenticated' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in to continue', code: 'unauthenticated' });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'Administrator access required', code: 'forbidden' });
    return;
  }
  next();
}

export function isAdminIdentity(user: { telegramId: string | null; handle: string }) {
  if (user.telegramId && config.adminTelegramIds.includes(user.telegramId)) return true;
  return config.adminHandles.includes(user.handle.toLowerCase());
}

/** Simple in-memory sliding-window rate limiter. */
export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const hits = new Map<string, number[]>();
  const { windowMs, max } = options;
  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.key?.(req) ?? req.user?.id ?? req.ip ?? 'anonymous';
    const now = Date.now();
    const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (timestamps.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - timestamps[0])) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests. Please slow down.', code: 'rate_limited' });
      return;
    }
    timestamps.push(now);
    hits.set(key, timestamps);
    if (hits.size > 5000) {
      for (const [candidate, stamps] of hits) {
        if (!stamps.some((t) => now - t < windowMs)) hits.delete(candidate);
      }
    }
    next();
  };
}

export const guestSignInEnabled = guestLoginEnabled;
