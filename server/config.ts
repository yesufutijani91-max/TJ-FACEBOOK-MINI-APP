import crypto from 'node:crypto';
import path from 'node:path';

const bool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const root = process.cwd();

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3001),
  dataDir: path.resolve(root, process.env.DATA_DIR ?? 'data'),
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR ?? 'data/uploads'),

  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim(),
  supabaseServiceKey: (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    ''
  ).trim(),

  telegramBotToken: (process.env.TELEGRAM_BOT_TOKEN ?? '').trim(),
  telegramBotUsername: (process.env.TELEGRAM_BOT_USERNAME ?? '').trim(),
  telegramInitDataMaxAgeSec: int(process.env.TELEGRAM_INITDATA_MAX_AGE, 86_400),

  sessionSecret: (process.env.SESSION_SECRET ?? '').trim(),
  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 30),

  adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  adminHandles: (process.env.ADMIN_HANDLES ?? '')
    .split(',')
    .map((value) => value.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean),

  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 25),
  allowGuestLogin: process.env.ALLOW_GUEST_LOGIN
    ? bool(process.env.ALLOW_GUEST_LOGIN, true)
    : undefined,
};

export const supabaseConfigured = Boolean(config.supabaseUrl && config.supabaseServiceKey);
export const telegramConfigured = Boolean(config.telegramBotToken);

/**
 * Guest (no-Telegram) sign-in is available while the bot token is not
 * configured, and can be switched on explicitly for staging environments.
 */
export const guestLoginEnabled =
  config.allowGuestLogin ?? !telegramConfigured;

/** Session secret: provided by the environment, or generated per boot. */
export const sessionSecret =
  config.sessionSecret ||
  (() => {
    const generated = crypto.randomBytes(48).toString('hex');
    if (config.nodeEnv === 'production') {
      console.warn(
        '[config] SESSION_SECRET is not set — sessions will be invalidated on restart.',
      );
    }
    return generated;
  })();

export function assertRuntimeConfig() {
  if (config.supabaseUrl && !config.supabaseServiceKey) {
    console.warn('[config] SUPABASE_URL is set but SUPABASE_SERVICE_ROLE_KEY is missing.');
  }
  if (!telegramConfigured) {
    console.warn(
      '[config] TELEGRAM_BOT_TOKEN is not set — Telegram sign-in is disabled and guest sign-in is used.',
    );
  }
}
