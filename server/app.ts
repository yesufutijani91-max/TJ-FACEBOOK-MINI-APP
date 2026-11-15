import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import type {
  AppSettings,
  FeedScope,
  MediaType,
  Privacy,
  SessionInfo,
} from '../shared/types.js';
import {
  attachUser,
  clearSessionCookie,
  guestSignInEnabled,
  isAdminIdentity,
  rateLimit,
  requireAdmin,
  requireAuth,
  sessionCookie,
  signSession,
  validateTelegramInitData,
} from './auth.js';
import { config, guestLoginEnabled, telegramConfigured } from './config.js';
import { events } from './events.js';
import { classifyMime, maxUploadBytes, resolveLocalUpload, storeUpload } from './media.js';
import { getStore } from './store/index.js';
import type { Store } from './store/types.js';
import { getBotUsername, queueTelegramMessage } from './telegram.js';

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

const badRequest = (message: string) =>
  Object.assign(new Error(message), { status: 400, expose: true });
const notFound = (message = 'Not found') =>
  Object.assign(new Error(message), { status: 404, expose: true });
const forbidden = (message = 'Not allowed') =>
  Object.assign(new Error(message), { status: 403, expose: true });

const limitOf = (value: unknown, fallback: number, max: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

/** Creates a notification, pushes it over SSE and (optionally) Telegram. */
async function pushNotification(
  store: Store,
  input: {
    userId: string;
    actorId?: string | null;
    type: Parameters<Store['notify']>[0]['type'];
    entityType?: Parameters<Store['notify']>[0]['entityType'];
    entityId?: string | null;
    message: string;
  },
) {
  if (input.userId === input.actorId) return;
  try {
    const notification = await store.notify({
      userId: input.userId,
      actorId: input.actorId ?? null,
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      message: input.message,
    });
    events.publish([input.userId], { type: 'notification', notification });
    if (input.type !== 'message') {
      const recipient = await store.getUser(input.userId);
      if (recipient?.telegramId) {
        queueTelegramMessage(recipient.telegramId, `<b>TJ Social</b>\n${input.message}`);
      }
    }
  } catch (error) {
    console.warn('[notify] failed', (error as Error).message);
  }
}

/** Express 5 types route params as string | string[]; normalize to a string. */
const param = (req: Request, key: string): string => {
  const value = (req.params as Record<string, string | string[]>)[key];
  return Array.isArray(value) ? (value[0] ?? '') : String(value ?? '');
};

const handleSchema = z.string().trim().min(3).max(32).regex(/^[a-z0-9_.]+$/i, 'Use letters, numbers, dot or underscore');
const contentSchema = z.string().trim().min(1, 'Write something first').max(5000);

export async function createApp() {
  const store = await getStore();
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(express.json({ limit: '512kb' }));
  app.use(attachUser(store));

  // -------------------------------------------------------------------------
  // Session and authentication
  // -------------------------------------------------------------------------
  app.get(
    '/api/health',
    handle(async (_req, res) => {
      res.json({ ok: true, mode: store.kind, telegram: telegramConfigured, at: new Date().toISOString() });
    }),
  );

  app.get(
    '/api/session',
    handle(async (req, res) => {
      if (req.user) void store.touchUser(req.user.id);
      const info: SessionInfo = {
        user: req.user ?? null,
        mode: store.kind,
        features: {
          telegram: telegramConfigured,
          devLogin: guestLoginEnabled,
          storage: store.kind === 'supabase' ? 'supabase' : 'local',
          botUsername: telegramConfigured ? await getBotUsername() : null,
        },
      };
      res.json(info);
    }),
  );

  const ensureHandle = async (desired: string, currentId?: string) => {
    const base = desired
      .toLowerCase()
      .replace(/[^a-z0-9_.]+/g, '')
      .slice(0, 24) || 'user';
    let candidate = base;
    let attempt = 0;
    // Handles are unique; append a numeric suffix until one is free.
    for (;;) {
      const existing = await store.searchUsers(candidate, 5);
      const clash = existing.find(
        (candidateUser) =>
          candidateUser.handle.toLowerCase() === candidate && candidateUser.id !== currentId,
      );
      if (!clash) return candidate;
      attempt += 1;
      candidate = `${base}${attempt}`;
    }
  };

  app.post(
    '/api/auth/telegram',
    rateLimit({ windowMs: 10 * 60_000, max: 30 }),
    handle(async (req, res) => {
      const parsed = z.object({ initData: z.string().min(10).max(8192) }).safeParse(req.body);
      if (!parsed.success) throw badRequest('initData is required');
      const payload = validateTelegramInitData(parsed.data.initData);
      if (!payload) {
        res.status(401).json({
          error:
            'Telegram sign-in could not be verified. Open TJ Social from your Telegram bot so initData can be validated.',
          code: 'invalid_initdata',
        });
        return;
      }
      let user = await store.getUserByTelegramId(payload.id);
      if (!user) {
        const handle = await ensureHandle(payload.username ?? `tg${payload.id}`);
        user = await store.createUser({
          telegramId: payload.id,
          handle,
          name: [payload.firstName, payload.lastName].filter(Boolean).join(' ').slice(0, 60),
          username: payload.username ?? null,
          avatarUrl: payload.photoUrl ?? null,
          isAdmin: isAdminIdentity({ telegramId: payload.id, handle }),
        });
      } else {
        const isAdmin = isAdminIdentity({ telegramId: payload.id, handle: user.handle });
        user = await store.updateUser(user.id, {
          name: [payload.firstName, payload.lastName].filter(Boolean).join(' ').slice(0, 60),
          username: payload.username ?? user.username,
          avatarUrl: payload.photoUrl ?? user.avatarUrl,
          lastSeenAt: new Date().toISOString(),
          ...(isAdmin !== user.isAdmin ? { isAdmin } : {}),
        });
      }
      const session = signSession(user.id);
      res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
      res.json({ user, token: session.token, expiresAt: session.expiresAt });
    }),
  );

  app.post(
    '/api/auth/guest',
    rateLimit({ windowMs: 10 * 60_000, max: 20 }),
    handle(async (req, res) => {
      if (!guestLoginEnabled) {
        res.status(403).json({
          error: 'Guest sign-in is disabled. Open the Mini App inside Telegram to continue.',
          code: 'guest_disabled',
        });
        return;
      }
      const parsed = z
        .object({ name: z.string().trim().min(2).max(40), handle: handleSchema.optional() })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest('Enter a display name of at least 2 characters');
      const handle = await ensureHandle(parsed.data.handle ?? parsed.data.name);
      const user = await store.createUser({
        name: parsed.data.name,
        handle,
        isAdmin: isAdminIdentity({ telegramId: null, handle }),
      });
      const session = signSession(user.id);
      res.setHeader('Set-Cookie', sessionCookie(session.token, session.expiresAt));
      res.json({ user, token: session.token, expiresAt: session.expiresAt });
    }),
  );

  app.post('/api/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------
  app.patch(
    '/api/me',
    requireAuth,
    handle(async (req, res) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(60).optional(),
          handle: handleSchema.optional(),
          bio: z.string().trim().max(300).nullable().optional(),
          location: z.string().trim().max(80).nullable().optional(),
          website: z.string().trim().max(200).nullable().optional(),
          privacy: z.enum(['public', 'friends', 'private']).optional(),
          theme: z.enum(['light', 'dark', 'system']).nullable().optional(),
          avatarUrl: z.string().max(600).nullable().optional(),
          coverUrl: z.string().max(600).nullable().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid profile data');
      if (parsed.data.handle && parsed.data.handle.toLowerCase() !== req.user!.handle) {
        parsed.data.handle = await ensureHandle(parsed.data.handle, req.user!.id);
      }
      const user = await store.updateUser(req.user!.id, parsed.data);
      res.json({ user });
    }),
  );

  app.get(
    '/api/users/:id',
    handle(async (req, res) => {
      const viewerId = req.user?.id ?? null;
      const target = await store.getUser(param(req, 'id'));
      if (!target) throw notFound('This account no longer exists');
      const friendState = viewerId
        ? await store.friendState(viewerId, target.id)
        : { status: 'none' as const, friendshipId: null };
      const isFollowing = viewerId ? await store.isFollowing(viewerId, target.id) : false;
      const isFriend = friendState.status === 'friends';
      const canViewContent =
        target.privacy === 'public' ||
        target.id === viewerId ||
        isFriend ||
        req.user?.isAdmin === true;
      res.json({
        user: target,
        postCount: await store.countPostsByAuthor(target.id),
        friendCount: await store.countFriends(target.id),
        followerCount: await store.countFollowers(target.id),
        followingCount: await store.countFollowing(target.id),
        friendState,
        isFollowing,
        canViewContent,
      });
    }),
  );

  app.get(
    '/api/users/:id/posts',
    handle(async (req, res) => {
      const target = await store.getUser(param(req, 'id'));
      if (!target) throw notFound('This account no longer exists');
      const viewerId = req.user?.id ?? null;
      const canView =
        target.privacy === 'public' ||
        target.id === viewerId ||
        req.user?.isAdmin === true ||
        (viewerId ? (await store.friendState(viewerId, target.id)).status === 'friends' : false);
      if (!canView) {
        res.json({ items: [], nextCursor: null, private: true });
        return;
      }
      const page = await store.listFeed({
        viewerId,
        scope: 'profile',
        authorId: target.id,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
        limit: limitOf(req.query.limit, 10, 30),
      });
      res.json(page);
    }),
  );

  for (const relation of ['friends', 'followers', 'following'] as const) {
    app.get(
      `/api/users/:id/${relation}`,
      handle(async (req, res) => {
        const target = await store.getUser(param(req, 'id'));
        if (!target) throw notFound('This account no longer exists');
        const users =
          relation === 'friends'
            ? await store.listFriends(target.id)
            : relation === 'followers'
              ? await store.listFollowers(target.id)
              : await store.listFollowing(target.id);
        res.json({ items: users });
      }),
    );
  }

  app.get(
    '/api/me/friends',
    requireAuth,
    handle(async (req, res) => {
      res.json({ items: await store.listFriends(req.user!.id) });
    }),
  );

  app.get(
    '/api/me/friend-requests',
    requireAuth,
    handle(async (req, res) => {
      res.json(await store.listFriendRequests(req.user!.id));
    }),
  );

  app.get(
    '/api/me/blocked',
    requireAuth,
    handle(async (req, res) => {
      res.json({ items: await store.listBlocked(req.user!.id) });
    }),
  );

  app.post(
    '/api/users/:id/follow',
    requireAuth,
    rateLimit({ windowMs: 60_000, max: 40 }),
    handle(async (req, res) => {
      const target = await store.getUser(param(req, 'id'));
      if (!target) throw notFound('This account no longer exists');
      await store.follow(req.user!.id, target.id);
      await pushNotification(store, {
        userId: target.id,
        actorId: req.user!.id,
        type: 'follow',
        entityType: 'user',
        entityId: req.user!.id,
        message: `${req.user!.name} started following you.`,
      });
      res.json({ following: true });
    }),
  );

  app.delete(
    '/api/users/:id/follow',
    requireAuth,
    handle(async (req, res) => {
      await store.unfollow(req.user!.id, param(req, 'id'));
      res.json({ following: false });
    }),
  );

  app.post(
    '/api/users/:id/friend-request',
    requireAuth,
    rateLimit({ windowMs: 60_000, max: 30 }),
    handle(async (req, res) => {
      const target = await store.getUser(param(req, 'id'));
      if (!target) throw notFound('This account no longer exists');
      if (target.id === req.user!.id) throw badRequest('You cannot add yourself');
      const state = await store.sendFriendRequest(req.user!.id, target.id);
      if (state.status === 'pending_out') {
        await pushNotification(store, {
          userId: target.id,
          actorId: req.user!.id,
          type: 'friend_request',
          entityType: 'user',
          entityId: req.user!.id,
          message: `${req.user!.name} sent you a friend request.`,
        });
      } else if (state.status === 'friends') {
        await pushNotification(store, {
          userId: target.id,
          actorId: req.user!.id,
          type: 'friend_accept',
          entityType: 'user',
          entityId: req.user!.id,
          message: `You and ${req.user!.name} are now friends.`,
        });
      }
      res.json(state);
    }),
  );

  app.post(
    '/api/friendships/:id/respond',
    requireAuth,
    handle(async (req, res) => {
      const parsed = z.object({ accept: z.boolean() }).safeParse(req.body);
      if (!parsed.success) throw badRequest('accept must be a boolean');
      try {
        const result = await store.respondFriendRequest(param(req, 'id'), req.user!.id, parsed.data.accept);
        if (result.accepted) {
          await pushNotification(store, {
            userId: result.requesterId,
            actorId: req.user!.id,
            type: 'friend_accept',
            entityType: 'user',
            entityId: req.user!.id,
            message: `${req.user!.name} accepted your friend request.`,
          });
        }
        res.json(result);
      } catch (error) {
        throw badRequest((error as Error).message);
      }
    }),
  );

  app.delete(
    '/api/friendships/:id',
    requireAuth,
    handle(async (req, res) => {
      try {
        await store.removeFriendship(param(req, 'id'), req.user!.id);
        res.json({ ok: true });
      } catch (error) {
        throw badRequest((error as Error).message);
      }
    }),
  );

  app.post(
    '/api/users/:id/block',
    requireAuth,
    handle(async (req, res) => {
      if (param(req, 'id') === req.user!.id) throw badRequest('You cannot block yourself');
      await store.blockUser(req.user!.id, param(req, 'id'));
      res.json({ blocked: true });
    }),
  );

  app.delete(
    '/api/users/:id/block',
    requireAuth,
    handle(async (req, res) => {
      await store.unblockUser(req.user!.id, param(req, 'id'));
      res.json({ blocked: false });
    }),
  );

  app.get(
    '/api/people/suggestions',
    handle(async (req, res) => {
      res.json({ items: await store.suggestedUsers(req.user?.id ?? null, limitOf(req.query.limit, 8, 20)) });
    }),
  );

  // -------------------------------------------------------------------------
  // Posts, feed and comments
  // -------------------------------------------------------------------------
  const mediaSchema = z.object({
    url: z.string().min(1).max(1000),
    type: z.enum(['image', 'video']),
  });

  app.get(
    '/api/feed',
    handle(async (req, res) => {
      const scope = (String(req.query.scope ?? 'home') as FeedScope) ?? 'home';
      const allowed: FeedScope[] = ['home', 'latest', 'video', 'saved', 'profile', 'group'];
      if (!allowed.includes(scope)) throw badRequest('Unknown feed scope');
      if (scope === 'saved' && !req.user) throw forbidden('Sign in to see saved posts');
      const page = await store.listFeed({
        viewerId: req.user?.id ?? null,
        scope,
        authorId: typeof req.query.authorId === 'string' ? req.query.authorId : undefined,
        groupId: typeof req.query.groupId === 'string' ? req.query.groupId : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
        limit: limitOf(req.query.limit, 10, 30),
      });
      res.json(page);
    }),
  );

  app.post(
    '/api/posts',
    requireAuth,
    rateLimit({ windowMs: 5 * 60_000, max: 25 }),
    handle(async (req, res) => {
      const parsed = z
        .object({
          content: z.string().trim().max(5000).default(''),
          visibility: z.enum(['public', 'friends', 'private']).default('public'),
          groupId: z.string().uuid().nullable().optional(),
          sharedPostId: z.string().uuid().nullable().optional(),
          media: z.array(mediaSchema).max(6).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid post');
      const { content, visibility, groupId, sharedPostId, media } = parsed.data;
      if (!content && !(media && media.length) && !sharedPostId) {
        throw badRequest('Add text, media or a post to share');
      }
      if (groupId) {
        const group = await store.getGroup(groupId, req.user!.id);
        if (!group) throw notFound('Group not found');
        if (!group.isMember && group.privacy === 'private') throw forbidden('Join the group to post');
      }
      if (sharedPostId) {
        const original = await store.getPost(sharedPostId);
        if (!original) throw notFound('The original post is unavailable');
      }
      const post = await store.createPost({
        authorId: req.user!.id,
        content,
        visibility: visibility as Privacy,
        groupId: groupId ?? null,
        sharedPostId: sharedPostId ?? null,
        media: (media ?? []) as { url: string; type: MediaType }[],
      });
      res.status(201).json({ post });
    }),
  );

  app.get(
    '/api/posts/:id',
    handle(async (req, res) => {
      const post = await store.getPostView(param(req, 'id'), req.user?.id ?? null);
      if (!post) throw notFound('Post not found');
      res.json({ post });
    }),
  );

  app.patch(
    '/api/posts/:id',
    requireAuth,
    handle(async (req, res) => {
      const existing = await store.getPost(param(req, 'id'));
      if (!existing) throw notFound('Post not found');
      if (existing.authorId !== req.user!.id && !req.user!.isAdmin) throw forbidden();
      const parsed = z
        .object({
          content: z.string().trim().max(5000).optional(),
          visibility: z.enum(['public', 'friends', 'private']).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid post update');
      await store.updatePost(param(req, 'id'), parsed.data);
      const post = await store.getPostView(param(req, 'id'), req.user!.id);
      res.json({ post });
    }),
  );

  app.delete(
    '/api/posts/:id',
    requireAuth,
    handle(async (req, res) => {
      const existing = await store.getPost(param(req, 'id'));
      if (!existing) throw notFound('Post not found');
      if (existing.authorId !== req.user!.id && !req.user!.isAdmin) throw forbidden();
      await store.deletePost(param(req, 'id'));
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/posts/:id/like',
    requireAuth,
    rateLimit({ windowMs: 60_000, max: 120 }),
    handle(async (req, res) => {
      const result = await store.toggleLike(param(req, 'id'), req.user!.id);
      if (result.liked) {
        await pushNotification(store, {
          userId: result.authorId,
          actorId: req.user!.id,
          type: 'like',
          entityType: 'post',
          entityId: param(req, 'id'),
          message: `${req.user!.name} liked your post.`,
        });
      }
      res.json({ liked: result.liked, likeCount: result.likeCount });
    }),
  );

  app.post(
    '/api/posts/:id/save',
    requireAuth,
    handle(async (req, res) => {
      const result = await store.toggleSave(param(req, 'id'), req.user!.id);
      res.json(result);
    }),
  );

  app.post(
    '/api/posts/:id/share',
    requireAuth,
    rateLimit({ windowMs: 5 * 60_000, max: 30 }),
    handle(async (req, res) => {
      const original = await store.getPostView(param(req, 'id'), req.user!.id);
      if (!original) throw notFound('Post not found');
      const parsed = z.object({ content: z.string().trim().max(1000).optional() }).safeParse(req.body ?? {});
      const post = await store.createPost({
        authorId: req.user!.id,
        content: parsed.success ? parsed.data.content ?? '' : '',
        visibility: 'public',
        sharedPostId: original.id,
      });
      await pushNotification(store, {
        userId: original.authorId,
        actorId: req.user!.id,
        type: 'like',
        entityType: 'post',
        entityId: original.id,
        message: `${req.user!.name} shared your post.`,
      });
      res.status(201).json({ post });
    }),
  );

  app.get(
    '/api/posts/:id/comments',
    handle(async (req, res) => {
      res.json({ items: await store.listComments(param(req, 'id'), req.user?.id ?? null) });
    }),
  );

  app.post(
    '/api/posts/:id/comments',
    requireAuth,
    rateLimit({ windowMs: 5 * 60_000, max: 60 }),
    handle(async (req, res) => {
      const parsed = z
        .object({ content: contentSchema, parentId: z.string().uuid().nullable().optional() })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Write a comment');
      const post = await store.getPost(param(req, 'id'));
      if (!post) throw notFound('Post not found');
      const comment = await store.createComment({
        postId: post.id,
        authorId: req.user!.id,
        parentId: parsed.data.parentId ?? null,
        content: parsed.data.content,
      });
      const parent = parsed.data.parentId ? await store.getComment(parsed.data.parentId) : null;
      await pushNotification(store, {
        userId: parent ? parent.authorId : post.authorId,
        actorId: req.user!.id,
        type: parent ? 'reply' : 'comment',
        entityType: 'post',
        entityId: post.id,
        message: parent
          ? `${req.user!.name} replied to your comment.`
          : `${req.user!.name} commented on your post.`,
      });
      res.status(201).json({ comment });
    }),
  );

  app.delete(
    '/api/comments/:id',
    requireAuth,
    handle(async (req, res) => {
      const comment = await store.getComment(param(req, 'id'));
      if (!comment) throw notFound('Comment not found');
      if (comment.authorId !== req.user!.id && !req.user!.isAdmin) throw forbidden();
      await store.deleteComment(param(req, 'id'));
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/reports',
    requireAuth,
    rateLimit({ windowMs: 10 * 60_000, max: 15 }),
    handle(async (req, res) => {
      const parsed = z
        .object({
          targetType: z.enum(['post', 'comment', 'user', 'story', 'listing']),
          targetId: z.string().uuid(),
          reason: z.string().trim().min(2).max(80),
          details: z.string().trim().max(1000).nullable().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest('Tell us why you are reporting this');
      await store.createReport({ reporterId: req.user!.id, ...parsed.data });
      res.status(201).json({ ok: true, message: 'Thanks — our moderators will review this.' });
    }),
  );

  // -------------------------------------------------------------------------
  // Stories
  // -------------------------------------------------------------------------
  app.get(
    '/api/stories',
    handle(async (req, res) => {
      res.json({ items: await store.listStoryGroups(req.user?.id ?? null) });
    }),
  );

  app.post(
    '/api/stories',
    requireAuth,
    rateLimit({ windowMs: 60 * 60_000, max: 30 }),
    handle(async (req, res) => {
      const parsed = z
        .object({
          mediaUrl: z.string().max(1000).nullable().optional(),
          mediaType: z.enum(['image', 'video']).nullable().optional(),
          caption: z.string().trim().max(300).nullable().optional(),
          background: z.string().trim().max(40).nullable().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid story');
      const { mediaUrl, mediaType, caption, background } = parsed.data;
      if (!mediaUrl && !caption) throw badRequest('Add a photo, video or some text');
      const story = await store.createStory({
        authorId: req.user!.id,
        mediaUrl: mediaUrl ?? null,
        mediaType: mediaType ?? null,
        caption: caption ?? null,
        background: background ?? null,
      });
      res.status(201).json({ story });
    }),
  );

  app.post(
    '/api/stories/:id/view',
    requireAuth,
    handle(async (req, res) => {
      const story = await store.getStory(param(req, 'id'), req.user!.id);
      if (!story) throw notFound('Story expired');
      await store.viewStory(param(req, 'id'), req.user!.id);
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/stories/:id/viewers',
    requireAuth,
    handle(async (req, res) => {
      const story = await store.getStory(param(req, 'id'), req.user!.id);
      if (!story) throw notFound('Story expired');
      if (story.authorId !== req.user!.id && !req.user!.isAdmin) throw forbidden();
      res.json({ items: await store.listStoryViewers(param(req, 'id')) });
    }),
  );

  app.post(
    '/api/stories/:id/react',
    requireAuth,
    handle(async (req, res) => {
      const parsed = z.object({ emoji: z.string().min(1).max(8) }).safeParse(req.body);
      if (!parsed.success) throw badRequest('Pick an emoji');
      const story = await store.getStory(param(req, 'id'), req.user!.id);
      if (!story) throw notFound('Story expired');
      const result = await store.reactToStory(param(req, 'id'), req.user!.id, parsed.data.emoji);
      await pushNotification(store, {
        userId: result.authorId,
        actorId: req.user!.id,
        type: 'story_reaction',
        entityType: 'story',
        entityId: param(req, 'id'),
        message: `${req.user!.name} reacted ${parsed.data.emoji} to your story.`,
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/stories/:id/reply',
    requireAuth,
    handle(async (req, res) => {
      const parsed = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(req.body);
      if (!parsed.success) throw badRequest('Write a reply');
      const story = await store.getStory(param(req, 'id'), req.user!.id);
      if (!story) throw notFound('Story expired');
      if (story.authorId === req.user!.id) throw badRequest('You cannot reply to your own story');
      const conversation = await store.getOrCreateConversation(req.user!.id, story.authorId);
      const message = await store.createMessage({
        conversationId: conversation.id,
        senderId: req.user!.id,
        body: `Replied to your story: ${parsed.data.text}`,
      });
      events.publish([story.authorId, req.user!.id], {
        type: 'message',
        conversationId: conversation.id,
        message,
      });
      await pushNotification(store, {
        userId: story.authorId,
        actorId: req.user!.id,
        type: 'story_reply',
        entityType: 'story',
        entityId: story.id,
        message: `${req.user!.name} replied to your story.`,
      });
      res.json({ ok: true, conversationId: conversation.id, message });
    }),
  );

  // -------------------------------------------------------------------------
  // Media uploads
  // -------------------------------------------------------------------------
  app.post(
    '/api/media',
    requireAuth,
    rateLimit({ windowMs: 10 * 60_000, max: 60 }),
    express.raw({ type: () => true, limit: maxUploadBytes() }),
    handle(async (req, res) => {
      const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim();
      if (!classifyMime(mime)) {
        throw badRequest('Upload a JPEG, PNG, WebP, GIF, AVIF, MP4, WebM or MOV file');
      }
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buffer.length) throw badRequest('The uploaded file is empty');
      const stored = await storeUpload(buffer, mime, req.user!.id);
      res.status(201).json(stored);
    }),
  );

  app.get('/api/media/*key', (req, res, next) => {
    // Express 5 exposes a named wildcard as an array of path segments.
    const raw = (req.params as Record<string, string | string[]>).key;
    const key = decodeURIComponent(Array.isArray(raw) ? raw.join('/') : String(raw ?? ''));
    const file = resolveLocalUpload(key);
    if (!file) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(file);
  });

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------
  app.get(
    '/api/conversations',
    requireAuth,
    handle(async (req, res) => {
      res.json({ items: await store.listConversations(req.user!.id) });
    }),
  );

  app.post(
    '/api/conversations',
    requireAuth,
    handle(async (req, res) => {
      const parsed = z.object({ userId: z.string().uuid() }).safeParse(req.body);
      if (!parsed.success) throw badRequest('Pick a person to message');
      const other = await store.getUser(parsed.data.userId);
      if (!other) throw notFound('This account no longer exists');
      if (other.id === req.user!.id) throw badRequest('You cannot message yourself');
      if (await store.isBlocked(other.id, req.user!.id)) throw forbidden('You cannot message this person');
      const conversation = await store.getOrCreateConversation(req.user!.id, other.id);
      res.json(conversation);
    }),
  );

  app.get(
    '/api/conversations/:id/messages',
    requireAuth,
    handle(async (req, res) => {
      const conversation = await store.getConversation(param(req, 'id'));
      if (!conversation) throw notFound('Conversation not found');
      if (conversation.userA !== req.user!.id && conversation.userB !== req.user!.id) throw forbidden();
      const items = await store.listMessages(conversation.id, {
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
        limit: limitOf(req.query.limit, 30, 60),
      });
      await store.markConversationRead(conversation.id, req.user!.id);
      res.json({ items, typing: await store.typingUsers(conversation.id, req.user!.id) });
    }),
  );

  app.post(
    '/api/conversations/:id/messages',
    requireAuth,
    rateLimit({ windowMs: 60_000, max: 90 }),
    handle(async (req, res) => {
      const conversation = await store.getConversation(param(req, 'id'));
      if (!conversation) throw notFound('Conversation not found');
      if (conversation.userA !== req.user!.id && conversation.userB !== req.user!.id) throw forbidden();
      const parsed = z
        .object({
          body: z.string().trim().max(4000).default(''),
          mediaUrl: z.string().max(1000).nullable().optional(),
          mediaType: z.enum(['image', 'video']).nullable().optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid message');
      if (!parsed.data.body && !parsed.data.mediaUrl) throw badRequest('Write a message first');
      const otherId = conversation.userA === req.user!.id ? conversation.userB : conversation.userA;
      if (await store.isBlocked(otherId, req.user!.id)) throw forbidden('You cannot message this person');
      const message = await store.createMessage({
        conversationId: conversation.id,
        senderId: req.user!.id,
        body: parsed.data.body,
        mediaUrl: parsed.data.mediaUrl ?? null,
        mediaType: parsed.data.mediaType ?? null,
      });
      events.publish([otherId, req.user!.id], {
        type: 'message',
        conversationId: conversation.id,
        message,
      });
      await pushNotification(store, {
        userId: otherId,
        actorId: req.user!.id,
        type: 'message',
        entityType: 'conversation',
        entityId: conversation.id,
        message: `New message from ${req.user!.name}.`,
      });
      res.status(201).json({ message });
    }),
  );

  app.post(
    '/api/conversations/:id/read',
    requireAuth,
    handle(async (req, res) => {
      const conversation = await store.getConversation(param(req, 'id'));
      if (!conversation) throw notFound('Conversation not found');
      if (conversation.userA !== req.user!.id && conversation.userB !== req.user!.id) throw forbidden();
      await store.markConversationRead(conversation.id, req.user!.id);
      const otherId = conversation.userA === req.user!.id ? conversation.userB : conversation.userA;
      events.publish([otherId], { type: 'read', conversationId: conversation.id, userId: req.user!.id });
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/conversations/:id/typing',
    requireAuth,
    handle(async (req, res) => {
      const conversation = await store.getConversation(param(req, 'id'));
      if (!conversation) throw notFound('Conversation not found');
      if (conversation.userA !== req.user!.id && conversation.userB !== req.user!.id) throw forbidden();
      await store.setTyping(conversation.id, req.user!.id);
      const otherId = conversation.userA === req.user!.id ? conversation.userB : conversation.userA;
      events.publish([otherId], { type: 'typing', conversationId: conversation.id, userId: req.user!.id });
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/badges',
    requireAuth,
    handle(async (req, res) => {
      res.json({
        notifications: await store.countUnreadNotifications(req.user!.id),
        messages: await store.countUnreadMessages(req.user!.id),
      });
    }),
  );

  app.get('/api/events', requireAuth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: ping\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
    void store.touchUser(req.user!.id);
    const id = events.add(req.user!.id, res);
    const ping = setInterval(() => {
      try {
        res.write(`event: ping\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
      } catch {
        clearInterval(ping);
      }
    }, 25_000);
    req.on('close', () => {
      clearInterval(ping);
      events.remove(id);
    });
  });

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------
  app.get(
    '/api/groups',
    handle(async (req, res) => {
      res.json({
        items: await store.listGroups({
          query: typeof req.query.q === 'string' ? req.query.q : undefined,
          viewerId: req.user?.id ?? null,
          limit: limitOf(req.query.limit, 30, 50),
        }),
      });
    }),
  );

  app.post(
    '/api/groups',
    requireAuth,
    rateLimit({ windowMs: 60 * 60_000, max: 10 }),
    handle(async (req, res) => {
      const parsed = z
        .object({
          name: z.string().trim().min(3).max(80),
          description: z.string().trim().max(600).nullable().optional(),
          coverUrl: z.string().max(1000).nullable().optional(),
          privacy: z.enum(['public', 'private']).default('public'),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid group');
      const group = await store.createGroup({ ...parsed.data, ownerId: req.user!.id });
      res.status(201).json({ group });
    }),
  );

  app.get(
    '/api/groups/:id',
    handle(async (req, res) => {
      const group = await store.getGroup(param(req, 'id'), req.user?.id ?? null);
      if (!group) throw notFound('Group not found');
      res.json({ group });
    }),
  );

  app.post(
    '/api/groups/:id/join',
    requireAuth,
    handle(async (req, res) => {
      const group = await store.getGroup(param(req, 'id'), req.user!.id);
      if (!group) throw notFound('Group not found');
      await store.joinGroup(group.id, req.user!.id);
      if (group.ownerId !== req.user!.id) {
        await pushNotification(store, {
          userId: group.ownerId,
          actorId: req.user!.id,
          type: 'group',
          entityType: 'group',
          entityId: group.id,
          message: `${req.user!.name} joined ${group.name}.`,
        });
      }
      res.json({ joined: true });
    }),
  );

  app.delete(
    '/api/groups/:id/join',
    requireAuth,
    handle(async (req, res) => {
      await store.leaveGroup(param(req, 'id'), req.user!.id);
      res.json({ joined: false });
    }),
  );

  app.get(
    '/api/groups/:id/members',
    handle(async (req, res) => {
      res.json({ items: await store.listGroupMembers(param(req, 'id')) });
    }),
  );

  app.post(
    '/api/groups/:id/members/:userId/role',
    requireAuth,
    handle(async (req, res) => {
      const group = await store.getGroup(param(req, 'id'), req.user!.id);
      if (!group) throw notFound('Group not found');
      const isOwner = group.ownerId === req.user!.id;
      if (!isOwner && group.role !== 'admin') throw forbidden('Only group admins can change roles');
      const parsed = z.object({ role: z.enum(['admin', 'member']) }).safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid role');
      await store.setGroupRole(group.id, param(req, 'userId'), parsed.data.role);
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/groups/:id',
    requireAuth,
    handle(async (req, res) => {
      const group = await store.getGroup(param(req, 'id'), req.user!.id);
      if (!group) throw notFound('Group not found');
      if (group.ownerId !== req.user!.id && !req.user!.isAdmin) throw forbidden();
      await store.deleteGroup(group.id);
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/groups/:id/posts',
    handle(async (req, res) => {
      const group = await store.getGroup(param(req, 'id'), req.user?.id ?? null);
      if (!group) throw notFound('Group not found');
      if (group.privacy === 'private' && !group.isMember) throw forbidden('Join the group to read its posts');
      const page = await store.listFeed({
        viewerId: req.user?.id ?? null,
        scope: 'group',
        groupId: group.id,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
        limit: limitOf(req.query.limit, 10, 30),
      });
      res.json(page);
    }),
  );

  // -------------------------------------------------------------------------
  // Marketplace
  // -------------------------------------------------------------------------
  app.get(
    '/api/listings',
    handle(async (req, res) => {
      res.json(
        await store.listListings({
          query: typeof req.query.q === 'string' ? req.query.q : undefined,
          category: typeof req.query.category === 'string' ? req.query.category : undefined,
          sellerId: typeof req.query.sellerId === 'string' ? req.query.sellerId : undefined,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
          limit: limitOf(req.query.limit, 20, 40),
        }),
      );
    }),
  );

  app.post(
    '/api/listings',
    requireAuth,
    rateLimit({ windowMs: 60 * 60_000, max: 20 }),
    handle(async (req, res) => {
      const parsed = z
        .object({
          title: z.string().trim().min(3).max(120),
          description: z.string().trim().min(3).max(4000),
          priceCents: z.number().int().min(0).max(100_000_000),
          category: z.string().trim().min(2).max(40),
          location: z.string().trim().max(80).nullable().optional(),
          images: z.array(z.string().max(1000)).max(6).optional(),
          currency: z.string().trim().length(3).default('USD'),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'Invalid listing');
      const listing = await store.createListing({ sellerId: req.user!.id, ...parsed.data });
      res.status(201).json({ listing });
    }),
  );

  app.get(
    '/api/listings/:id',
    handle(async (req, res) => {
      const listing = await store.getListing(param(req, 'id'));
      if (!listing) throw notFound('Listing not found');
      res.json({ listing });
    }),
  );

  app.patch(
    '/api/listings/:id',
    requireAuth,
    handle(async (req, res) => {
      const listing = await store.getListing(param(req, 'id'));
      if (!listing) throw notFound('Listing not found');
      if (listing.sellerId !== req.user!.id && !req.user!.isAdmin) throw forbidden();
      const parsed = z
        .object({
          title: z.string().trim().min(3).max(120).optional(),
          description: z.string().trim().min(3).max(4000).optional(),
          priceCents: z.number().int().min(0).max(100_000_000).optional(),
          category: z.string().trim().min(2).max(40).optional(),
          location: z.string().trim().max(80).nullable().optional(),
          images: z.array(z.string().max(1000)).max(6).optional(),
          status: z.enum(['active', 'sold']).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid listing update');
      res.json({ listing: await store.updateListing(listing.id, parsed.data) });
    }),
  );

  app.delete(
    '/api/listings/:id',
    requireAuth,
    handle(async (req, res) => {
      const listing = await store.getListing(param(req, 'id'));
      if (!listing) throw notFound('Listing not found');
      if (listing.sellerId !== req.user!.id && !req.user!.isAdmin) throw forbidden();
      await store.deleteListing(listing.id);
      res.json({ ok: true });
    }),
  );

  // -------------------------------------------------------------------------
  // Notifications, search and discovery
  // -------------------------------------------------------------------------
  app.get(
    '/api/notifications',
    requireAuth,
    handle(async (req, res) => {
      res.json({ items: await store.listNotifications(req.user!.id, limitOf(req.query.limit, 40, 100)) });
    }),
  );

  app.post(
    '/api/notifications/read',
    requireAuth,
    handle(async (req, res) => {
      await store.markNotificationsRead(req.user!.id);
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/search',
    handle(async (req, res) => {
      const query = String(req.query.q ?? '').trim();
      if (query.length < 2) {
        res.json({ users: [], posts: [], groups: [], listings: [] });
        return;
      }
      res.json(await store.search(query.slice(0, 80), req.user?.id ?? null));
    }),
  );

  app.get(
    '/api/trending',
    handle(async (req, res) => {
      res.json(await store.trending());
    }),
  );

  // -------------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------------
  app.get(
    '/api/admin/stats',
    requireAdmin,
    handle(async (_req, res) => {
      res.json(await store.adminStats());
    }),
  );

  app.get(
    '/api/admin/users',
    requireAdmin,
    handle(async (req, res) => {
      const limit = limitOf(req.query.limit, 50, 100);
      const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? '0'), 10) || 0);
      res.json({
        items: await store.listUsers({
          query: typeof req.query.q === 'string' ? req.query.q : undefined,
          limit,
          offset,
        }),
        total: await store.countUsers(),
      });
    }),
  );

  app.post(
    '/api/admin/users/:id/suspend',
    requireAdmin,
    handle(async (req, res) => {
      const parsed = z.object({ suspended: z.boolean() }).safeParse(req.body);
      if (!parsed.success) throw badRequest('suspended must be a boolean');
      if (param(req, 'id') === req.user!.id) throw badRequest('You cannot suspend your own account');
      const user = await store.updateUser(param(req, 'id'), { suspended: parsed.data.suspended });
      res.json({ user });
    }),
  );

  app.get(
    '/api/admin/reports',
    requireAdmin,
    handle(async (req, res) => {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const allowed = ['open', 'resolved', 'dismissed'] as const;
      res.json({
        items: await store.listReports(
          allowed.includes(status as (typeof allowed)[number])
            ? (status as (typeof allowed)[number])
            : undefined,
        ),
      });
    }),
  );

  app.post(
    '/api/admin/reports/:id/resolve',
    requireAdmin,
    handle(async (req, res) => {
      const parsed = z.object({ status: z.enum(['resolved', 'dismissed']) }).safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid status');
      await store.resolveReport(param(req, 'id'), req.user!.id, parsed.data.status);
      res.json({ ok: true });
    }),
  );

  app.delete(
    '/api/admin/posts/:id',
    requireAdmin,
    handle(async (req, res) => {
      await store.deletePost(param(req, 'id'));
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/admin/groups',
    requireAdmin,
    handle(async (_req, res) => {
      res.json({ items: await store.listGroups({ viewerId: null, limit: 100 }) });
    }),
  );

  app.delete(
    '/api/admin/groups/:id',
    requireAdmin,
    handle(async (req, res) => {
      await store.deleteGroup(param(req, 'id'));
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/admin/settings',
    requireAdmin,
    handle(async (_req, res) => {
      res.json({ settings: await store.getSettings() });
    }),
  );

  app.patch(
    '/api/admin/settings',
    requireAdmin,
    handle(async (req, res) => {
      const parsed = z
        .object({
          siteName: z.string().trim().min(2).max(40).optional(),
          tagline: z.string().trim().min(2).max(80).optional(),
          registrationOpen: z.boolean().optional(),
          maxUploadMb: z.number().int().min(1).max(100).optional(),
          maintenanceMessage: z.string().trim().max(300).optional(),
        })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid settings');
      const settings: AppSettings = await store.updateSettings(parsed.data);
      res.json({ settings });
    }),
  );

  // -------------------------------------------------------------------------
  // Static client + error handling
  // -------------------------------------------------------------------------
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  const distDir = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { maxAge: '1h', index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use((error: Error & { status?: number; expose?: boolean }, _req: Request, res: Response, _next: NextFunction) => {
    const status = error.status ?? 500;
    if (status >= 500) console.error('[api]', error);
    const message =
      status >= 500 && !error.expose ? 'Something went wrong. Please try again.' : error.message;
    if (res.headersSent) return;
    res.status(status).json({ error: message });
  });

  return { app, store };
}
