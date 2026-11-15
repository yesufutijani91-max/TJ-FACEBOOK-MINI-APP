# TJ SOCIAL — Connect. Share. Discover.

A full-stack social network built to run inside Telegram as a Mini App, and in any mobile or
desktop browser. React + TypeScript + Vite on the client, an Express API on the server, and
Supabase (PostgreSQL, storage, RLS) as the production data layer.

## Features

- **Feed** — text/image/video/link posts, emoji, multi-image uploads, edit, delete, like,
  comment, reply, share, save, report, engagement counts, chronological and personalised views.
- **Stories** — photo, video and text stories with captions, viewers, reactions and replies.
  Stories expire 24 hours after publishing.
- **People** — Telegram-based accounts, profile picture and cover uploads, bio, location,
  profile privacy, friends, friend requests, follows, blocking.
- **Messaging** — one-to-one conversations, text and media messages, read receipts, online
  status, typing indicators, conversation list, unread badges, server-sent event updates.
- **Groups** — create, join, leave, group posts, admin roles and membership management.
- **Marketplace** — listings with photos, description, price and category, browse, search and
  contact the seller. No payment processing is implemented or simulated.
- **Notifications** — likes, comments, friend requests, follows, messages, group and story
  activity, with an unread badge and mark-all-read.
- **Search** — people, posts, groups and listings, plus trending posts and suggested accounts.
- **Admin** — users, platform statistics, reports, suspension, post deletion, group and
  engagement management, application settings. Restricted to configured administrators.

## 1. Install

```bash
git clone https://github.com/<your-account>/tj-facebook-mini-app.git
cd tj-facebook-mini-app
npm install
cp .env.example .env      # then edit .env
npm run dev               # API on :3001, Vite dev server on :5173
```

`npm run dev` starts the API and the Vite dev server together. Open http://localhost:5173.

The app runs without any external service configured: if Supabase variables are absent the API
uses a file-backed store (`DATA_DIR`) and stores uploads under `UPLOAD_DIR`, both served back
through `/api/media/*`. This is the local development and preview mode.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | API + Vite dev server with reload |
| `npm run typecheck` | Type-check client and server |
| `npm test` | Functional API test suite (14 suites, real HTTP against the app) |
| `npm run build` | Build the client (`dist/`) and server (`dist-server/`) |
| `npm start` | Run the built server (serves `dist/` and the API) |

## 2. Connect Supabase

1. Create a project at https://supabase.com (the free tier is sufficient).
2. Open **SQL Editor** and run `supabase/migrations/0001_init.sql`. It creates every table
   (`users`, `profiles`, `posts`, `post_media`, `likes`, `comments`, `comment_replies`,
   `friendships`, `follows`, `stories`, `story_views`, `conversations`, `messages`,
   `notifications`, `groups`, `group_members`, `marketplace_listings`, `saved_posts`,
   `reports`), their indexes, the storage bucket and the Row Level Security policies.
3. Copy the project URL, the `anon` key and the `service_role` key from
   **Project Settings → API** into `.env`:

```ini
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_STORAGE_BUCKET=tj-social
```

The `service_role` key is used **only** on the server, never shipped to the browser. All writes
that need to bypass RLS (Telegram sign-in, moderation, counters) go through the API. Once these
variables are set the API switches from the file store to Supabase automatically; uploads move
to Supabase Storage.

## 3. Configure the Telegram bot

1. In **@BotFather**, create (or reuse) your bot and copy its token.
2. Put it in `.env` — server-side only, never in client code:

```ini
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_BOT_USERNAME=your_bot
```

3. Publish the app over HTTPS (see step 4), then in BotFather use
   **/newapp** (or **Bot Settings → Menu Button**) and set the Mini App URL to your deployment,
   for example `https://your-app.example.com`.
4. Optionally set a domain with **/setdomain** so Telegram opens the Mini App in-app.

The client loads `telegram-web-app.js`, applies the Telegram theme, viewport and safe areas,
and wires the BackButton and MainButton. Sign-in sends `initData` to `POST /api/auth/telegram`;
the server verifies the HMAC signature with the bot token, rejects stale payloads and issues its
own signed session cookie. Frontend-supplied Telegram user data is never trusted on its own.

Bot notifications: when a user has authorised the bot to message them, the API sends
notification messages through the Bot API using the same server-side token.

## 4. Deploy

**Docker / any container host**

```bash
docker build -t tj-social .
docker run -p 3000:3000 --env-file .env tj-social
```

The image builds the client and server, runs as a non-root `node` user and exposes port `3000`
with a `/api/health` healthcheck. Provide `SESSION_SECRET` (a long random string) and
`APP_ORIGIN` (the public HTTPS origin) in production.

**Cloudflare Pages / Workers** — the client is a static Vite build, so `dist/` can be served
from Pages while `/api/*` is proxied to the container running the Express API.

Deployment checklist:

- `SESSION_SECRET` set to a strong random value.
- `APP_ORIGIN` matches the public URL (used for cookie and CORS decisions).
- `ADMIN_TELEGRAM_IDS` set (step 6).
- HTTPS in front of the app, so Telegram can load the Mini App.

## 5. Test

```bash
npm run typecheck   # client + server types
npm test            # API suite: auth, posts, friendships, follows/blocking, messaging,
                    # stories, groups, marketplace, search, notifications, media, admin
npm run build       # production client + server build
```

The test suite boots the real server, signs in two users plus an administrator, and exercises
every feature area over HTTP, including media round-trips and authorisation failures. It uses a
temporary data directory, so it never touches your development data.

Manual mobile check: open the dev server (or the deployment) with a phone viewport — bottom
navigation, composer, stories and the messaging view are all mobile-first. Inside Telegram, open
the bot's Mini App button to confirm theme, viewport and BackButton behaviour.

## 6. Configure the administrator account

Administrators are identified by Telegram user ID, configured on the server:

```ini
ADMIN_TELEGRAM_IDS=123456789,987654321
```

Send `/start` (or use the Mini App) once so the account exists, then reload — the session
response marks the account as administrator and the **Admin** entry appears in Settings.
Administrators can review reports, suspend accounts, delete posts, manage groups and change
application settings. Everyone else receives `403` from `/api/admin/*`.

For local development without Telegram, set `ALLOW_DEV_LOGIN=true` to enable the guest sign-in
button on the login screen. Guest accounts are created through the same server-side session
flow; list their IDs in `ADMIN_TELEGRAM_IDS` to test the admin dashboard. Disable this flag in
production.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | for Telegram | Bot API token; verifies `initData`, sends bot messages. Server-side only. |
| `TELEGRAM_BOT_USERNAME` | optional | Bot username shown in the client. |
| `SUPABASE_URL` | for Supabase | Project URL. |
| `SUPABASE_ANON_KEY` | for Supabase | Public key used for storage reads. |
| `SUPABASE_SERVICE_ROLE_KEY` | for Supabase | Server-side key for privileged writes. Never expose it. |
| `SUPABASE_STORAGE_BUCKET` | optional | Media bucket name (default `tj-social`). |
| `SESSION_SECRET` | production | Signs session cookies. |
| `APP_ORIGIN` | production | Public HTTPS origin of the app. |
| `ADMIN_TELEGRAM_IDS` | for admin | Comma-separated Telegram user IDs with admin rights. |
| `ALLOW_DEV_LOGIN` | development | Enables guest sign-in when Telegram is unavailable. |
| `PORT` | optional | API port (default `3001`; the container sets `3000`). |
| `DATA_DIR` / `UPLOAD_DIR` | optional | File-store data and upload directories. |

## Architecture

```
src/            React client: pages, components, session state, API client, Telegram helpers
server/         Express API: auth (Telegram + sessions), routes, media, events (SSE), config
server/store/   Data layer: Supabase store and local file store behind one interface
shared/         Domain types shared by client and server
supabase/       SQL migration: schema, indexes, RLS policies, storage bucket
tests/          Functional API test suite
```

Security: `initData` HMAC verification, server-issued signed sessions, RLS on every table,
Zod validation on request bodies, rate limiting on auth and write endpoints, upload size and
MIME checks, and an admin-only namespace for moderation routes.
