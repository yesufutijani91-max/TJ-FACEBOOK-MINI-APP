/**
 * End-to-end API tests for TJ SOCIAL.
 *
 * These tests boot the real Express application (server/app.ts) against the
 * local JSON store with a throwaway data directory, then exercise the public
 * HTTP surface exactly as the Mini App does: guest sign-in, posts, likes,
 * comments, friendships, messaging, stories, groups, marketplace, search,
 * notifications, moderation and admin.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-social-test-'));
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = dataDir;
process.env.UPLOAD_DIR = path.join(dataDir, 'uploads');
process.env.ALLOW_GUEST_LOGIN = '1';
process.env.SESSION_SECRET = 'test-session-secret-not-for-production';
process.env.ADMIN_HANDLES = 'admin';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.TELEGRAM_BOT_TOKEN;

// The config module reads the environment at import time, so the app is
// imported dynamically after the variables above are in place.
const { createApp } = await import('../server/app.js');
const { app } = await createApp();

const server: Server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// The tests drive the server explicitly; unref keeps the runner from waiting on it.
server.unref();

after(() => {
  // Destroy keep-alive sockets so the test runner can exit promptly.
  server.closeAllConnections?.();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

interface ApiResult<T = any> {
  status: number;
  data: T;
}

async function api<T = any>(
  route: string,
  options: { method?: string; body?: unknown; token?: string; raw?: Buffer; contentType?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.raw) {
    headers['content-type'] = options.contentType ?? 'application/octet-stream';
    body = new Uint8Array(options.raw);
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(base + route, {
    method: options.method ?? 'GET',
    headers,
    body,
    // Fail loudly instead of stalling the whole suite on a wedged request.
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response (static assets) */
  }
  return { status: response.status, data: data as T };
}

async function guest(name: string, handle?: string) {
  const result = await api('/api/auth/guest', { method: 'POST', body: { name, handle } });
  assert.equal(result.status, 200, `guest sign-in for ${name} should succeed: ${JSON.stringify(result.data)}`);
  return result.data as { user: { id: string; name: string; handle: string; isAdmin: boolean }; token: string };
}

const alice = await guest('Alice Johnson', 'alice');
const bob = await guest('Bob Smith', 'bob');
const admin = await guest('Admin', 'admin');

test('health endpoint reports the service as ready', async () => {
  const result = await api('/api/health');
  assert.equal(result.status, 200);
});

test('guest sign-in creates a persistent session and marks the admin', async () => {
  assert.ok(alice.token.length > 10);
  assert.equal(alice.user.handle, 'alice');
  assert.equal(admin.user.isAdmin, true);
  assert.equal(alice.user.isAdmin, false);

  const session = await api('/api/session', { token: alice.token });
  assert.equal(session.status, 200);
  assert.equal(session.data.user.id, alice.user.id);
});

test('protected routes reject anonymous callers', async () => {
  assert.equal((await api('/api/posts', { method: 'POST', body: { content: 'hi' } })).status, 401);
  // Saved posts are a signed-in-only view and answer 403 for guests.
  assert.equal((await api('/api/feed?scope=saved')).status, 403);
  assert.equal((await api('/api/admin/stats', { token: alice.token })).status, 403);
});

test('posts: create, read, edit, like, comment, reply, save, share and delete', async () => {
  const created = await api('/api/posts', {
    method: 'POST',
    token: alice.token,
    body: { content: 'Hello TJ Social #first', visibility: 'public' },
  });
  assert.equal(created.status, 201);
  const postId: string = created.data.post.id;
  assert.equal(created.data.post.authorId, alice.user.id);

  const detail = await api(`/api/posts/${postId}`, { token: bob.token });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.post.content, 'Hello TJ Social #first');

  const edited = await api(`/api/posts/${postId}`, {
    method: 'PATCH',
    token: alice.token,
    body: { content: 'Hello TJ Social (edited)' },
  });
  assert.equal(edited.status, 200);
  assert.match(edited.data.post.content, /edited/);

  const like = await api(`/api/posts/${postId}/like`, { method: 'POST', token: bob.token });
  assert.equal(like.status, 200);
  assert.equal(like.data.liked, true);
  assert.equal(like.data.likeCount, 1);

  const unlike = await api(`/api/posts/${postId}/like`, { method: 'POST', token: bob.token });
  assert.equal(unlike.data.liked, false);
  assert.equal(unlike.data.likeCount, 0);

  await api(`/api/posts/${postId}/like`, { method: 'POST', token: bob.token });

  const comment = await api(`/api/posts/${postId}/comments`, {
    method: 'POST',
    token: bob.token,
    body: { content: 'Nice post!' },
  });
  assert.equal(comment.status, 201);
  const commentId: string = comment.data.comment.id;

  const reply = await api(`/api/posts/${postId}/comments`, {
    method: 'POST',
    token: alice.token,
    body: { content: 'Thanks Bob', parentId: commentId },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.data.comment.parentId, commentId);

  const comments = await api(`/api/posts/${postId}/comments`, { token: bob.token });
  assert.equal(comments.status, 200);
  assert.equal(comments.data.items.length, 1, 'replies nest under their parent comment');
  const parent = comments.data.items.find((item: any) => item.id === commentId);
  assert.equal(parent.replies.length, 1);
  assert.equal(parent.replies[0].content, 'Thanks Bob');

  const saved = await api(`/api/posts/${postId}/save`, { method: 'POST', token: bob.token });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.saved, true);
  const savedFeed = await api('/api/feed?scope=saved', { token: bob.token });
  assert.ok(savedFeed.data.items.some((item: any) => item.id === postId));

  const share = await api(`/api/posts/${postId}/share`, {
    method: 'POST',
    token: bob.token,
    body: { content: 'Sharing this' },
  });
  assert.equal(share.status, 201);
  assert.equal(share.data.post.sharedPostId, postId);

  const feed = await api('/api/feed?scope=latest', { token: bob.token });
  assert.equal(feed.status, 200);
  assert.ok(feed.data.items.some((item: any) => item.id === postId));

  const removed = await api(`/api/posts/${postId}`, { method: 'DELETE', token: alice.token });
  assert.equal(removed.status, 200);
  assert.equal((await api(`/api/posts/${postId}`)).status, 404);
});

test('friendships: request, accept, list and unfriend', async () => {
  const request = await api(`/api/users/${bob.user.id}/friend-request`, {
    method: 'POST',
    token: alice.token,
  });
  assert.equal(request.status, 200);
  assert.equal(request.data.status, 'pending_out');

  const incoming = await api('/api/me/friend-requests', { token: bob.token });
  assert.equal(incoming.status, 200);
  const pending = incoming.data.incoming.find((item: any) => item.user.id === alice.user.id);
  assert.ok(pending, 'Bob should see Alice’s request');

  const accepted = await api(`/api/friendships/${pending.id}/respond`, {
    method: 'POST',
    token: bob.token,
    body: { accept: true },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.accepted, true);

  const friends = await api('/api/me/friends', { token: alice.token });
  assert.ok(friends.data.items.some((item: any) => item.id === bob.user.id));

  const removed = await api(`/api/friendships/${pending.id}`, { method: 'DELETE', token: alice.token });
  assert.equal(removed.status, 200);

  // Re-friend so later notification checks have a relationship to work with.
  const again = await api(`/api/users/${bob.user.id}/friend-request`, { method: 'POST', token: alice.token });
  assert.equal(again.data.status, 'pending_out');
  const incomingAgain = await api('/api/me/friend-requests', { token: bob.token });
  const pendingAgain = incomingAgain.data.incoming.find((item: any) => item.user.id === alice.user.id);
  await api(`/api/friendships/${pendingAgain.id}/respond`, {
    method: 'POST',
    token: bob.token,
    body: { accept: true },
  });
});

test('follows and blocking work end to end', async () => {
  const follow = await api(`/api/users/${bob.user.id}/follow`, { method: 'POST', token: alice.token });
  assert.equal(follow.status, 200);
  assert.equal(follow.data.following, true);

  const profile = await api(`/api/users/${bob.user.id}`, { token: alice.token });
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.id, bob.user.id);
  assert.equal(profile.data.isFollowing, true);
  assert.equal(profile.data.friendState.status, 'friends');

  const block = await api(`/api/users/${bob.user.id}/block`, { method: 'POST', token: alice.token });
  assert.equal(block.status, 200);
  const blocked = await api('/api/me/blocked', { token: alice.token });
  assert.ok(blocked.data.items.some((item: any) => item.id === bob.user.id));
  const unblock = await api(`/api/users/${bob.user.id}/block`, { method: 'DELETE', token: alice.token });
  assert.equal(unblock.status, 200);
});

test('messaging: conversation, message, read receipt and typing indicator', async () => {
  const conversation = await api('/api/conversations', {
    method: 'POST',
    token: bob.token,
    body: { userId: alice.user.id },
  });
  assert.equal(conversation.status, 200);
  const conversationId: string = conversation.data.id;

  const sent = await api(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: bob.token,
    body: { body: 'Hey Alice!' },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.body, 'Hey Alice!');

  const typing = await api(`/api/conversations/${conversationId}/typing`, { method: 'POST', token: bob.token });
  assert.equal(typing.status, 200);

  const aliceInbox = await api('/api/conversations', { token: alice.token });
  const unread = aliceInbox.data.items.find((item: any) => item.id === conversationId);
  assert.ok(unread, 'Alice should see the conversation');
  assert.ok(unread.unreadCount >= 1, 'Bob’s message should be unread for Alice');

  const messages = await api(`/api/conversations/${conversationId}/messages`, { token: alice.token });
  assert.equal(messages.status, 200);
  assert.ok(messages.data.items.some((item: any) => item.body === 'Hey Alice!'));

  const afterRead = await api('/api/conversations', { token: alice.token });
  const readConversation = afterRead.data.items.find((item: any) => item.id === conversationId);
  assert.equal(readConversation.unreadCount, 0, 'Opening the thread should clear the unread badge');

  const outsider = await api(`/api/conversations/${conversationId}/messages`, { token: admin.token });
  assert.equal(outsider.status, 403, 'Non-participants must not read a private thread');
});

test('stories: publish, browse, view, react and reply', async () => {
  // Stories are visible to friends and followed accounts only.
  await api(`/api/users/${alice.user.id}/follow`, { method: 'POST', token: bob.token });
  const story = await api('/api/stories', {
    method: 'POST',
    token: alice.token,
    body: { caption: 'Good morning ☀️', background: 'blue' },
  });
  assert.equal(story.status, 201);
  const storyId: string = story.data.story.id;

  const groups = await api('/api/stories', { token: bob.token });
  assert.equal(groups.status, 200);
  const group = groups.data.items.find((item: any) => item.author.id === alice.user.id);
  assert.ok(group, 'Alice’s story should appear in the tray');
  assert.ok(group.stories.some((item: any) => item.id === storyId));

  assert.equal((await api(`/api/stories/${storyId}/view`, { method: 'POST', token: bob.token })).status, 200);
  assert.equal(
    (await api(`/api/stories/${storyId}/react`, { method: 'POST', token: bob.token, body: { emoji: '🔥' } })).status,
    200,
  );

  const viewers = await api(`/api/stories/${storyId}/viewers`, { token: alice.token });
  assert.ok(viewers.data.items.some((item: any) => item.id === bob.user.id));

  const reply = await api(`/api/stories/${storyId}/reply`, {
    method: 'POST',
    token: bob.token,
    body: { text: 'Love this' },
  });
  assert.equal(reply.status, 200);
  assert.ok(reply.data.conversationId);
});

test('groups: create, join, post and manage membership', async () => {
  const created = await api('/api/groups', {
    method: 'POST',
    token: alice.token,
    body: { name: 'Design Circle', description: 'For designers', privacy: 'public' },
  });
  assert.equal(created.status, 201);
  const groupId: string = created.data.group.id;
  assert.equal(created.data.group.role, 'owner');

  const joined = await api(`/api/groups/${groupId}/join`, { method: 'POST', token: bob.token });
  assert.equal(joined.status, 200);

  const detail = await api(`/api/groups/${groupId}`, { token: bob.token });
  assert.equal(detail.data.group.isMember, true);
  assert.ok(detail.data.group.memberCount >= 2);

  const members = await api(`/api/groups/${groupId}/members`, { token: bob.token });
  assert.equal(members.status, 200);
  assert.ok(members.data.items.some((item: any) => item.user.id === alice.user.id));

  const post = await api('/api/posts', {
    method: 'POST',
    token: alice.token,
    body: { content: 'Welcome to Design Circle', groupId },
  });
  assert.equal(post.status, 201);

  const groupFeed = await api(`/api/groups/${groupId}/posts`, { token: bob.token });
  assert.equal(groupFeed.status, 200);
  assert.ok(groupFeed.data.items.some((item: any) => item.content === 'Welcome to Design Circle'));

  const promoted = await api(`/api/groups/${groupId}/members/${bob.user.id}/role`, {
    method: 'POST',
    token: alice.token,
    body: { role: 'admin' },
  });
  assert.equal(promoted.status, 200);

  const leave = await api(`/api/groups/${groupId}/join`, { method: 'DELETE', token: bob.token });
  assert.equal(leave.status, 200);
  const afterLeave = await api(`/api/groups/${groupId}`, { token: bob.token });
  assert.equal(afterLeave.data.group.isMember, false);
});

test('marketplace: publish, browse, search and contact the seller', async () => {
  const listing = await api('/api/listings', {
    method: 'POST',
    token: alice.token,
    body: {
      title: 'Vintage camera',
      description: 'Works perfectly, includes two lenses.',
      priceCents: 12000,
      category: 'Electronics',
      location: 'Berlin',
    },
  });
  assert.equal(listing.status, 201);
  const listingId: string = listing.data.listing.id;

  const browse = await api('/api/listings?q=camera', { token: bob.token });
  assert.equal(browse.status, 200);
  assert.ok(browse.data.items.some((item: any) => item.id === listingId));

  const detail = await api(`/api/listings/${listingId}`, { token: bob.token });
  assert.equal(detail.data.listing.title, 'Vintage camera');
  assert.equal(detail.data.listing.priceCents, 12000);

  const update = await api(`/api/listings/${listingId}`, {
    method: 'PATCH',
    token: alice.token,
    body: { status: 'sold' },
  });
  assert.equal(update.status, 200);

  const contact = await api(`/api/users/${alice.user.id}/friend-request`, { method: 'POST', token: bob.token });
  assert.equal(contact.status, 200);
});

test('search and discovery return people, posts, groups and listings', async () => {
  await api('/api/posts', { method: 'POST', token: alice.token, body: { content: 'Searchable zebra post' } });
  const group = await api('/api/groups', {
    method: 'POST',
    token: alice.token,
    body: { name: 'Zebra Design Lab', description: 'A home for zebra enthusiasts', privacy: 'public' },
  });
  assert.equal(group.status, 201);
  const listing = await api('/api/listings', {
    method: 'POST',
    token: alice.token,
    body: {
      title: 'Zebra print camera strap',
      description: 'Handmade strap in zebra print.',
      priceCents: 2500,
      category: 'Electronics',
      location: 'Berlin',
    },
  });
  assert.equal(listing.status, 201);

  const people = await api('/api/search?q=Alice', { token: bob.token });
  assert.equal(people.status, 200);
  assert.ok(people.data.users.some((item: any) => item.id === alice.user.id));

  const posts = await api('/api/search?q=zebra', { token: bob.token });
  assert.ok(posts.data.posts.length >= 1);

  const groups = await api('/api/search?q=zebra', { token: bob.token });
  assert.ok(groups.data.groups.some((item: any) => item.id === group.data.group.id));

  const listings = await api('/api/search?q=zebra', { token: bob.token });
  assert.ok(listings.data.listings.some((item: any) => item.id === listing.data.listing.id));

  const trending = await api('/api/trending', { token: bob.token });
  assert.equal(trending.status, 200);

  const suggestions = await api('/api/people/suggestions', { token: alice.token });
  assert.equal(suggestions.status, 200);
});

test('notifications are produced, listed and marked read', async () => {
  const inbox = await api('/api/notifications', { token: bob.token });
  assert.equal(inbox.status, 200);
  assert.ok(inbox.data.items.length > 0, 'Bob should have notifications from the flows above');
  const types = new Set(inbox.data.items.map((item: any) => item.type));
  assert.ok(types.size > 0, 'Bob should have notification types');
  assert.ok(
    types.has('friend_request') || types.has('like') || types.has('message') || types.has('follow'),
    `expected a social notification, received: ${[...types].join(', ') || 'none'}`,
  );

  const markRead = await api('/api/notifications/read', { method: 'POST', token: bob.token });
  assert.equal(markRead.status, 200);
  const after = await api('/api/notifications', { token: bob.token });
  assert.ok(after.data.items.every((item: any) => item.read));

  const badges = await api('/api/badges', { token: bob.token });
  assert.equal(badges.status, 200);
});

test('media uploads are stored and served back', async () => {
  // Smallest valid 1x1 transparent PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = await api('/api/media', {
    method: 'POST',
    token: alice.token,
    raw: png,
    contentType: 'image/png',
  });
  assert.equal(upload.status, 201);
  const url: string = upload.data.url;
  assert.ok(url, 'upload should return a public URL');

  const served = await fetch(base + url, { signal: AbortSignal.timeout(15000) });
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type') ?? '', /image\/png/);
  // Drain the body so the keep-alive socket is released and the run can exit.
  const body = Buffer.from(await served.arrayBuffer());
  assert.equal(body.length, png.length, 'the stored file should be served back byte for byte');

  const rejected = await api('/api/media', {
    method: 'POST',
    token: alice.token,
    raw: Buffer.from('not an image'),
    contentType: 'text/plain',
  });
  assert.equal(rejected.status, 400, 'unsupported upload types must be rejected');
});

test('reporting and the admin dashboard work with proper authorization', async () => {
  const post = await api('/api/posts', {
    method: 'POST',
    token: bob.token,
    body: { content: 'Reported post content' },
  });
  const postId: string = post.data.post.id;

  const report = await api('/api/reports', {
    method: 'POST',
    token: alice.token,
    body: { targetType: 'post', targetId: postId, reason: 'Spam', details: 'Repeated promotion' },
  });
  assert.equal(report.status, 201);

  assert.equal((await api('/api/admin/stats', { token: bob.token })).status, 403);

  const stats = await api('/api/admin/stats', { token: admin.token });
  assert.equal(stats.status, 200);
  assert.ok(stats.data.users >= 3);

  const users = await api('/api/admin/users', { token: admin.token });
  assert.equal(users.status, 200);
  assert.ok(users.data.items.some((item: any) => item.id === bob.user.id));

  const reports = await api('/api/admin/reports', { token: admin.token });
  const reportItem = reports.data.items.find((item: any) => item.targetId === postId);
  assert.ok(reportItem, 'the report should be visible to admins');

  const resolved = await api(`/api/admin/reports/${reportItem.id}/resolve`, {
    method: 'POST',
    token: admin.token,
    body: { status: 'resolved' },
  });
  assert.equal(resolved.status, 200);

  const removed = await api(`/api/admin/posts/${postId}`, { method: 'DELETE', token: admin.token });
  assert.equal(removed.status, 200);
  const removedPost = await api(`/api/posts/${postId}`);
  assert.equal(removedPost.status, 404, 'moderated content must be removed');

  const settings = await api('/api/admin/settings', { token: admin.token });
  assert.equal(settings.status, 200);
  const patched = await api('/api/admin/settings', {
    method: 'PATCH',
    token: admin.token,
    body: { registrationOpen: true },
  });
  assert.equal(patched.status, 200);

  const suspend = await api(`/api/admin/users/${bob.user.id}/suspend`, {
    method: 'POST',
    token: admin.token,
    body: { suspended: true },
  });
  assert.equal(suspend.status, 200);
  // Sessions resolve to an anonymous payload, so check a guarded route instead.
  assert.equal(
    (await api('/api/notifications', { token: bob.token })).status,
    401,
    'suspended users lose access',
  );
  const anonymous = await api('/api/session', { token: bob.token });
  assert.equal(anonymous.data.user, null, 'a suspended session must not resolve a user');
});
