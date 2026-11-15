import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminStats,
  AppNotification,
  AppSettings,
  CommentView,
  ConversationView,
  FriendRequestView,
  FriendState,
  Group,
  Listing,
  MediaType,
  MessageView,
  Paged,
  Post,
  PostView,
  Report,
  SearchResults,
  Story,
  StoryGroup,
  User,
} from '../../shared/types.js';
import type {
  CreateListingInput,
  CreatePostInput,
  CreateStoryInput,
  CreateUserInput,
  FeedQuery,
  NotifyInput,
  Store,
  UserPatch,
} from './types.js';

const USER_SELECT = '*, profile:profiles(*)';

const iso = () => new Date().toISOString();

type Row = Record<string, any>;

/** Maps a users row (with embedded profile) to the public User shape. */
export function toUser(row: Row): User {
  const profile = (row.profile ?? {}) as Row;
  return {
    id: row.id,
    telegramId: row.telegram_id ?? null,
    handle: row.handle,
    name: row.name,
    username: row.username ?? null,
    avatarUrl: row.avatar_url ?? null,
    coverUrl: profile.cover_url ?? null,
    bio: profile.bio ?? null,
    location: profile.location ?? null,
    website: profile.website ?? null,
    privacy: (profile.privacy ?? 'public') as User['privacy'],
    isAdmin: Boolean(row.is_admin),
    suspended: Boolean(row.suspended),
    theme: profile.theme ?? null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function toPost(row: Row): Post {
  return {
    id: row.id,
    authorId: row.author_id,
    content: row.content ?? '',
    visibility: row.visibility ?? 'public',
    groupId: row.group_id ?? null,
    sharedPostId: row.shared_post_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  };
}

function toListing(row: Row, seller: User): Listing {
  return {
    id: row.id,
    sellerId: row.seller_id,
    title: row.title,
    description: row.description ?? '',
    priceCents: row.price_cents,
    currency: row.currency ?? 'USD',
    category: row.category,
    location: row.location ?? null,
    images: Array.isArray(row.images) ? row.images : [],
    status: row.status ?? 'active',
    createdAt: row.created_at,
    seller,
  };
}

interface Rel {
  friends: Set<string>;
  following: Set<string>;
  blocked: Set<string>;
  groups: Set<string>;
}

const emptyRel = (): Rel => ({
  friends: new Set(),
  following: new Set(),
  blocked: new Set(),
  groups: new Set(),
});

/**
 * Supabase (Postgres + Storage + Realtime) implementation of the store.
 * Uses the service-role key server-side only; the browser never receives it.
 */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'tj-social' } },
    });
  }

  async init(): Promise<void> {
    const { error } = await this.db.from('users').select('id', { count: 'exact', head: true });
    if (error) {
      throw new Error(
        `Supabase is not ready (${error.message}). Run supabase/migrations/0001_init.sql first.`,
      );
    }
  }

  private async run<T>(builder: any): Promise<T> {
    const { data, error } = await builder;
    if (error) throw new Error(error.message);
    return data as T;
  }

  private async maybe<T>(builder: any, fallback: T): Promise<T> {
    try {
      return await this.run<T>(builder);
    } catch (error) {
      console.warn('[supabase] query failed', (error as Error).message);
      return fallback;
    }
  }

  private async rel(viewerId: string | null): Promise<Rel> {
    const rel = emptyRel();
    if (!viewerId) return rel;
    const [friendships, follows, blocks, memberships] = await Promise.all([
      this.maybe<Row[]>(
        this.db
          .from('friendships')
          .select('requester_id,addressee_id,status')
          .or(`requester_id.eq.${viewerId},addressee_id.eq.${viewerId}`),
        [],
      ),
      this.maybe<Row[]>(this.db.from('follows').select('following_id').eq('follower_id', viewerId), []),
      this.maybe<Row[]>(
        this.db
          .from('blocks')
          .select('blocker_id,blocked_id')
          .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`),
        [],
      ),
      this.maybe<Row[]>(this.db.from('group_members').select('group_id').eq('user_id', viewerId), []),
    ]);
    for (const f of friendships) {
      if (f.status !== 'accepted') continue;
      rel.friends.add(f.requester_id === viewerId ? f.addressee_id : f.requester_id);
    }
    for (const f of follows) rel.following.add(f.following_id);
    for (const b of blocks) {
      rel.blocked.add(b.blocker_id === viewerId ? b.blocked_id : b.blocker_id);
    }
    for (const m of memberships) rel.groups.add(m.group_id);
    return rel;
  }

  // ------------------------------------------------------------------ users
  async getUser(id: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('users').select(USER_SELECT).eq('id', id).limit(1),
      [],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserByTelegramId(telegramId: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('users').select(USER_SELECT).eq('telegram_id', telegramId).limit(1),
      [],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  private async uniqueHandle(base: string, ignoreId?: string): Promise<string> {
    const root =
      base
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 24) || 'user';
    let candidate = root;
    for (let suffix = 1; suffix < 60; suffix += 1) {
      const rows = await this.maybe<Row[]>(
        this.db.from('users').select('id').eq('handle', candidate).limit(1),
        [],
      );
      if (!rows[0] || rows[0].id === ignoreId) return candidate;
      candidate = `${root}${suffix + 1}`;
    }
    return `${root}${Date.now().toString().slice(-5)}`;
  }

  async createUser(input: CreateUserInput) {
    const handle = await this.uniqueHandle(input.handle || input.name);
    let isAdmin = input.isAdmin;
    if (isAdmin === undefined) {
      const { count } = await this.db.from('users').select('id', { count: 'exact', head: true });
      isAdmin = (count ?? 0) === 0;
    }
    const rows = await this.run<Row[]>(
      this.db
        .from('users')
        .insert({
          telegram_id: input.telegramId ?? null,
          handle,
          name: input.name.trim() || 'New member',
          username: input.username ?? null,
          avatar_url: input.avatarUrl ?? null,
          is_admin: Boolean(isAdmin),
        })
        .select('*'),
    );
    const created = rows[0];
    await this.run(
      this.db.from('profiles').upsert({ user_id: created.id, privacy: 'public' }, { onConflict: 'user_id' }),
    );
    return toUser({ ...created, profile: { privacy: 'public' } });
  }

  async updateUser(id: string, patch: UserPatch) {
    const userColumns: Row = {};
    const profileColumns: Row = {};
    if (patch.name !== undefined) userColumns.name = patch.name;
    if (patch.username !== undefined) userColumns.username = patch.username;
    if (patch.avatarUrl !== undefined) userColumns.avatar_url = patch.avatarUrl;
    if (patch.telegramId !== undefined) userColumns.telegram_id = patch.telegramId;
    if (patch.handle !== undefined) userColumns.handle = await this.uniqueHandle(patch.handle, id);
    if (patch.coverUrl !== undefined) profileColumns.cover_url = patch.coverUrl;
    if (patch.bio !== undefined) profileColumns.bio = patch.bio;
    if (patch.location !== undefined) profileColumns.location = patch.location;
    if (patch.website !== undefined) profileColumns.website = patch.website;
    if (patch.privacy !== undefined) profileColumns.privacy = patch.privacy;
    if (patch.theme !== undefined) profileColumns.theme = patch.theme;

    if (Object.keys(userColumns).length) {
      await this.run(this.db.from('users').update(userColumns).eq('id', id));
    }
    if (Object.keys(profileColumns).length) {
      await this.run(
        this.db.from('profiles').upsert({ user_id: id, ...profileColumns }, { onConflict: 'user_id' }),
      );
    }
    const user = await this.getUser(id);
    if (!user) throw new Error('User not found');
    return user;
  }

  async touchUser(id: string) {
    try {
      await this.db.from('users').update({ last_seen_at: iso() }).eq('id', id);
    } catch {
      /* presence is best-effort */
    }
  }

  async searchUsers(query: string, limit: number) {
    const q = query.trim();
    const builder = this.db.from('users').select(USER_SELECT).eq('suspended', false).limit(limit);
    const rows = await this.maybe<Row[]>(
      q
        ? builder.or(`name.ilike.%${q}%,handle.ilike.%${q}%,username.ilike.%${q}%`)
        : builder.order('created_at', { ascending: false }),
      [],
    );
    return rows.map(toUser);
  }

  async suggestedUsers(viewerId: string | null, limit: number) {
    const rel = await this.rel(viewerId);
    const rows = await this.maybe<Row[]>(
      this.db.from('users').select(USER_SELECT).eq('suspended', false).limit(limit * 3),
      [],
    );
    return rows
      .map(toUser)
      .filter(
        (u) =>
          u.id !== viewerId && !rel.blocked.has(u.id) && !rel.friends.has(u.id) && !rel.following.has(u.id),
      )
      .slice(0, limit);
  }

  async listUsers(opts: { query?: string; limit: number; offset: number }) {
    let builder = this.db
      .from('users')
      .select(USER_SELECT)
      .order('created_at', { ascending: false })
      .range(opts.offset, opts.offset + opts.limit - 1);
    if (opts.query) builder = builder.ilike('name', `%${opts.query}%`);
    const rows = await this.maybe<Row[]>(builder, []);
    return rows.map(toUser);
  }

  async countUsers() {
    const { count } = await this.db.from('users').select('id', { count: 'exact', head: true });
    return count ?? 0;
  }

  // ---------------------------------------------------------- relationships
  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) return;
    await this.maybe(
      this.db
        .from('follows')
        .upsert({ follower_id: followerId, following_id: followingId }, { onConflict: 'follower_id,following_id' }),
      null,
    );
  }

  async unfollow(followerId: string, followingId: string) {
    await this.maybe(
      this.db.from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId),
      null,
    );
  }

  async isFollowing(followerId: string, followingId: string) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('follows')
        .select('following_id')
        .eq('follower_id', followerId)
        .eq('following_id', followingId)
        .limit(1),
      [],
    );
    return rows.length > 0;
  }

  async listFollowers(userId: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('follows').select(`follower:users!follows_follower_id_fkey(${USER_SELECT})`).eq('following_id', userId),
      [],
    );
    return rows.map((r) => toUser(r.follower)).filter(Boolean);
  }

  async listFollowing(userId: string) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('follows')
        .select(`following:users!follows_following_id_fkey(${USER_SELECT})`)
        .eq('follower_id', userId),
      [],
    );
    return rows.map((r) => toUser(r.following)).filter(Boolean);
  }

  async countFollowers(userId: string) {
    const { count } = await this.db
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('following_id', userId);
    return count ?? 0;
  }

  async countFollowing(userId: string) {
    const { count } = await this.db
      .from('follows')
      .select('follower_id', { count: 'exact', head: true })
      .eq('follower_id', userId);
    return count ?? 0;
  }

  async friendState(viewerId: string, otherId: string): Promise<FriendState> {
    if (viewerId === otherId) return { status: 'self', friendshipId: null };
    const blocked = await this.isBlocked(viewerId, otherId);
    if (blocked) return { status: 'blocked', friendshipId: null };
    const rows = await this.maybe<Row[]>(
      this.db
        .from('friendships')
        .select('*')
        .or(
          `and(requester_id.eq.${viewerId},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${viewerId})`,
        )
        .limit(1),
      [],
    );
    const friendship = rows[0];
    if (!friendship) return { status: 'none', friendshipId: null };
    if (friendship.status === 'accepted') return { status: 'friends', friendshipId: friendship.id };
    return {
      status: friendship.requester_id === viewerId ? 'pending_out' : 'pending_in',
      friendshipId: friendship.id,
    };
  }

  async sendFriendRequest(fromId: string, toId: string) {
    if (fromId === toId) return this.friendState(fromId, toId);
    const existing = await this.friendState(fromId, toId);
    if (existing.friendshipId) {
      if (existing.status === 'pending_in') {
        await this.maybe(
          this.db
            .from('friendships')
            .update({ status: 'accepted', updated_at: iso() })
            .eq('id', existing.friendshipId),
          null,
        );
      }
      return this.friendState(fromId, toId);
    }
    await this.maybe(
      this.db
        .from('friendships')
        .insert({ requester_id: fromId, addressee_id: toId, status: 'pending' }),
      null,
    );
    return this.friendState(fromId, toId);
  }

  async respondFriendRequest(friendshipId: string, userId: string, accept: boolean) {
    const rows = await this.maybe<Row[]>(
      this.db.from('friendships').select('*').eq('id', friendshipId).limit(1),
      [],
    );
    const friendship = rows[0];
    if (!friendship) throw new Error('Friend request not found');
    if (friendship.addressee_id !== userId) throw new Error('Not allowed');
    if (accept) {
      await this.run(
        this.db.from('friendships').update({ status: 'accepted', updated_at: iso() }).eq('id', friendshipId),
      );
      return { requesterId: friendship.requester_id, accepted: true };
    }
    await this.run(this.db.from('friendships').delete().eq('id', friendshipId));
    return { requesterId: friendship.requester_id, accepted: false };
  }

  async listFriends(userId: string) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('friendships')
        .select(
          `requester:users!friendships_requester_id_fkey(${USER_SELECT}),addressee:users!friendships_addressee_id_fkey(${USER_SELECT})`,
        )
        .eq('status', 'accepted')
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
      [],
    );
    return rows
      .map((r) => toUser(r.requester.id === userId ? r.addressee : r.requester))
      .filter(Boolean);
  }

  async listFriendRequests(userId: string) {
    const [incomingRows, outgoingRows] = await Promise.all([
      this.maybe<Row[]>(
        this.db
          .from('friendships')
          .select(`id,created_at,user:users!friendships_requester_id_fkey(${USER_SELECT})`)
          .eq('addressee_id', userId)
          .eq('status', 'pending'),
        [],
      ),
      this.maybe<Row[]>(
        this.db
          .from('friendships')
          .select(`id,created_at,user:users!friendships_addressee_id_fkey(${USER_SELECT})`)
          .eq('requester_id', userId)
          .eq('status', 'pending'),
        [],
      ),
    ]);
    const incoming: FriendRequestView[] = incomingRows.map((r) => ({
      id: r.id,
      user: toUser(r.user),
      createdAt: r.created_at,
    }));
    const outgoing: FriendRequestView[] = outgoingRows.map((r) => ({
      id: r.id,
      user: toUser(r.user),
      createdAt: r.created_at,
    }));
    return { incoming, outgoing };
  }

  async countFriends(userId: string) {
    return (await this.listFriends(userId)).length;
  }

  async mutualFriendCount(a: string, b: string) {
    const [friendsA, friendsB] = await Promise.all([this.listFriends(a), this.listFriends(b)]);
    const setA = new Set(friendsA.map((u) => u.id));
    return friendsB.filter((u) => setA.has(u.id)).length;
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) return;
    await this.maybe(
      this.db
        .from('blocks')
        .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { onConflict: 'blocker_id,blocked_id' }),
      null,
    );
    await this.maybe(
      this.db
        .from('friendships')
        .delete()
        .or(
          `and(requester_id.eq.${blockerId},addressee_id.eq.${blockedId}),and(requester_id.eq.${blockedId},addressee_id.eq.${blockerId})`,
        ),
      null,
    );
    await this.maybe(
      this.db
        .from('follows')
        .delete()
        .or(
          `and(follower_id.eq.${blockerId},following_id.eq.${blockedId}),and(follower_id.eq.${blockedId},following_id.eq.${blockerId})`,
        ),
      null,
    );
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.maybe(
      this.db.from('blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', blockedId),
      null,
    );
  }

  async isBlocked(a: string, b: string) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('blocks')
        .select('blocker_id')
        .or(
          `and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`,
        )
        .limit(1),
      [],
    );
    return rows.length > 0;
  }

  async listBlocked(userId: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('blocks').select(`blocked:users!blocks_blocked_id_fkey(${USER_SELECT})`).eq('blocker_id', userId),
      [],
    );
    return rows.map((r) => toUser(r.blocked)).filter(Boolean);
  }

  // ------------------------------------------------------------------ posts
  private async hydratePosts(rows: Row[], viewerId: string | null, depth = 0): Promise<PostView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const authorIds = [...new Set(rows.map((r) => r.author_id))];
    const groupIds = [...new Set(rows.map((r) => r.group_id).filter(Boolean))];
    const sharedIds = [...new Set(rows.map((r) => r.shared_post_id).filter(Boolean))];

    const [authorRows, mediaRows, likeRows, commentRows, saveRows, shareRows, groupRows, memberRows, sharedRows] =
      await Promise.all([
        this.maybe<Row[]>(this.db.from('users').select(USER_SELECT).in('id', authorIds), []),
        this.maybe<Row[]>(this.db.from('post_media').select('*').in('post_id', ids).order('position'), []),
        this.maybe<Row[]>(this.db.from('likes').select('post_id,user_id').in('post_id', ids), []),
        this.maybe<Row[]>(
          this.db.from('comments').select('post_id').in('post_id', ids).is('deleted_at', null),
          [],
        ),
        this.maybe<Row[]>(this.db.from('saved_posts').select('post_id,user_id').in('post_id', ids), []),
        this.maybe<Row[]>(this.db.from('posts').select('shared_post_id').in('shared_post_id', ids).is('deleted_at', null), []),
        groupIds.length
          ? this.maybe<Row[]>(this.db.from('groups').select('*').in('id', groupIds), [])
          : Promise.resolve([]),
        groupIds.length
          ? this.maybe<Row[]>(this.db.from('group_members').select('group_id,user_id,role').in('group_id', groupIds), [])
          : Promise.resolve([]),
        depth === 0 && sharedIds.length
          ? this.maybe<Row[]>(this.db.from('posts').select('*').in('id', sharedIds), [])
          : Promise.resolve([]),
      ]);

    const authors = new Map(authorRows.map((r) => [r.id, toUser(r)]));
    const nested = depth === 0 && sharedRows.length ? await this.hydratePosts(sharedRows, viewerId, 1) : [];
    const nestedById = new Map(nested.map((p) => [p.id, p]));

    return rows.map((row) => {
      const post = toPost(row);
      const media = mediaRows
        .filter((m) => m.post_id === row.id)
        .map((m) => ({ id: m.id, url: m.url, type: m.type as MediaType, position: m.position }));
      const likes = likeRows.filter((l) => l.post_id === row.id);
      const group = row.group_id ? groupRows.find((g) => g.id === row.group_id) : null;
      const groupMembers = group ? memberRows.filter((m) => m.group_id === group.id) : [];
      const myMembership = group ? groupMembers.find((m) => m.user_id === viewerId) : null;
      return {
        ...post,
        author:
          authors.get(row.author_id) ??
          ({
            id: row.author_id,
            telegramId: null,
            handle: 'deleted',
            name: 'Deleted account',
            username: null,
            avatarUrl: null,
            coverUrl: null,
            bio: null,
            location: null,
            website: null,
            privacy: 'public',
            isAdmin: false,
            suspended: true,
            theme: null,
            createdAt: row.created_at,
            lastSeenAt: row.created_at,
          } as User),
        group: group
          ? ({
              id: group.id,
              name: group.name,
              description: group.description ?? null,
              coverUrl: group.cover_url ?? null,
              privacy: group.privacy,
              ownerId: group.owner_id,
              createdAt: group.created_at,
              memberCount: groupMembers.length,
              isMember: Boolean(myMembership),
              role: (myMembership?.role ?? null) as Group['role'],
            } satisfies Group)
          : null,
        media,
        likeCount: likes.length,
        commentCount: commentRows.filter((c) => c.post_id === row.id).length,
        shareCount: shareRows.filter((s) => s.shared_post_id === row.id).length,
        liked: Boolean(viewerId && likes.some((l) => l.user_id === viewerId)),
        saved: Boolean(viewerId && saveRows.some((s) => s.post_id === row.id && s.user_id === viewerId)),
        sharedPost: row.shared_post_id ? nestedById.get(row.shared_post_id) ?? null : null,
      } satisfies PostView;
    });
  }

  private canViewPost(post: Post, viewerId: string | null, rel: Rel, authorId: string) {
    if (post.deletedAt) return false;
    if (viewerId && authorId === viewerId) return true;
    if (viewerId && rel.blocked.has(authorId)) return false;
    if (post.groupId) {
      if (rel.groups.has(post.groupId)) return true;
      return post.visibility !== 'private';
    }
    if (post.visibility === 'public') return true;
    if (!viewerId) return false;
    if (post.visibility === 'friends') return rel.friends.has(authorId);
    return false;
  }

  async createPost(input: CreatePostInput) {
    const rows = await this.run<Row[]>(
      this.db
        .from('posts')
        .insert({
          author_id: input.authorId,
          content: input.content,
          visibility: input.visibility ?? 'public',
          group_id: input.groupId ?? null,
          shared_post_id: input.sharedPostId ?? null,
        })
        .select('*'),
    );
    const created = rows[0];
    if (input.media?.length) {
      await this.run(
        this.db.from('post_media').insert(
          input.media.map((m, index) => ({
            post_id: created.id,
            url: m.url,
            type: m.type,
            position: index,
          })),
        ),
      );
    }
    const [view] = await this.hydratePosts([created], input.authorId);
    return view;
  }

  async getPost(postId: string) {
    const rows = await this.maybe<Row[]>(this.db.from('posts').select('*').eq('id', postId).limit(1), []);
    return rows[0] ? toPost(rows[0]) : null;
  }

  async getPostView(postId: string, viewerId: string | null) {
    const rows = await this.maybe<Row[]>(this.db.from('posts').select('*').eq('id', postId).limit(1), []);
    if (!rows[0]) return null;
    const rel = await this.rel(viewerId);
    const post = toPost(rows[0]);
    if (!this.canViewPost(post, viewerId, rel, rows[0].author_id)) return null;
    const [view] = await this.hydratePosts(rows, viewerId);
    return view ?? null;
  }

  async listFeed(query: FeedQuery): Promise<Paged<PostView>> {
    const limit = Math.min(Math.max(query.limit || 10, 1), 30);
    const rel = await this.rel(query.viewerId);
    let builder = this.db.from('posts').select('*').is('deleted_at', null).order('created_at', { ascending: false });
    if (query.cursor) builder = builder.lt('created_at', query.cursor);
    builder = builder.limit(limit * 4);

    switch (query.scope) {
      case 'home': {
        const authors = new Set<string>([...(query.viewerId ? [query.viewerId] : []), ...rel.friends, ...rel.following]);
        const clauses: string[] = [];
        if (authors.size) clauses.push(`author_id.in.(${[...authors].join(',')})`);
        if (rel.groups.size) clauses.push(`group_id.in.(${[...rel.groups].join(',')})`);
        if (!clauses.length) return { items: [], nextCursor: null };
        builder = builder.or(clauses.join(','));
        break;
      }
      case 'latest':
        builder = builder.eq('visibility', 'public').is('group_id', null);
        break;
      case 'profile':
        builder = builder.eq('author_id', query.authorId ?? '');
        break;
      case 'group':
        builder = builder.eq('group_id', query.groupId ?? '');
        break;
      case 'saved': {
        const saves = await this.maybe<Row[]>(
          this.db.from('saved_posts').select('post_id').eq('user_id', query.viewerId ?? ''),
          [],
        );
        if (!saves.length) return { items: [], nextCursor: null };
        builder = builder.in('id', saves.map((s) => s.post_id));
        break;
      }
      case 'video': {
        const media = await this.maybe<Row[]>(
          this.db.from('post_media').select('post_id').eq('type', 'video'),
          [],
        );
        if (!media.length) return { items: [], nextCursor: null };
        builder = builder.in('id', [...new Set(media.map((m) => m.post_id))]);
        break;
      }
    }

    const rows = await this.maybe<Row[]>(builder, []);
    const visible = rows.filter((row) =>
      this.canViewPost(toPost(row), query.viewerId, rel, row.author_id),
    );
    const page = visible.slice(0, limit);
    const items = await this.hydratePosts(page, query.viewerId);
    return {
      items,
      nextCursor: visible.length > limit ? page[page.length - 1]?.created_at ?? null : null,
    };
  }

  async updatePost(postId: string, patch: { content?: string; visibility?: 'public' | 'friends' | 'private' }) {
    const columns: Row = { updated_at: iso() };
    if (patch.content !== undefined) columns.content = patch.content;
    if (patch.visibility !== undefined) columns.visibility = patch.visibility;
    const rows = await this.run<Row[]>(this.db.from('posts').update(columns).eq('id', postId).select('*'));
    if (!rows[0]) throw new Error('Post not found');
    return toPost(rows[0]);
  }

  async deletePost(postId: string) {
    await this.maybe(this.db.from('posts').update({ deleted_at: iso() }).eq('id', postId), null);
  }

  async toggleLike(postId: string, userId: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('likes').select('post_id').eq('post_id', postId).eq('user_id', userId).limit(1),
      [],
    );
    const post = await this.getPost(postId);
    if (!post) throw new Error('Post not found');
    if (rows.length) {
      await this.run(this.db.from('likes').delete().eq('post_id', postId).eq('user_id', userId));
    } else {
      await this.run(this.db.from('likes').insert({ post_id: postId, user_id: userId }));
    }
    const { count } = await this.db
      .from('likes')
      .select('post_id', { count: 'exact', head: true })
      .eq('post_id', postId);
    return { liked: rows.length === 0, likeCount: count ?? 0, authorId: post.authorId };
  }

  async toggleSave(postId: string, userId: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('saved_posts').select('post_id').eq('post_id', postId).eq('user_id', userId).limit(1),
      [],
    );
    if (rows.length) {
      await this.run(this.db.from('saved_posts').delete().eq('post_id', postId).eq('user_id', userId));
      return { saved: false };
    }
    await this.run(this.db.from('saved_posts').insert({ post_id: postId, user_id: userId }));
    return { saved: true };
  }

  async countPostsByAuthor(authorId: string) {
    const { count } = await this.db
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', authorId)
      .is('deleted_at', null);
    return count ?? 0;
  }

  async countPosts() {
    const { count } = await this.db
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);
    return count ?? 0;
  }

  // --------------------------------------------------------------- comments
  async createComment(input: { postId: string; authorId: string; parentId?: string | null; content: string }) {
    const rows = await this.run<Row[]>(
      this.db
        .from('comments')
        .insert({
          post_id: input.postId,
          author_id: input.authorId,
          parent_id: input.parentId ?? null,
          content: input.content,
        })
        .select('*'),
    );
    const row = rows[0];
    const authors = await this.maybe<Row[]>(
      this.db.from('users').select(USER_SELECT).eq('id', input.authorId).limit(1),
      [],
    );
    return {
      id: row.id,
      postId: row.post_id,
      authorId: row.author_id,
      parentId: row.parent_id ?? null,
      content: row.content,
      createdAt: row.created_at,
      deletedAt: null,
      author: authors[0] ? toUser(authors[0]) : ({} as User),
      replies: [],
    } satisfies CommentView;
  }

  async listComments(postId: string, _viewerId: string | null) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('comments')
        .select(`*, author:users!comments_author_id_fkey(${USER_SELECT})`)
        .eq('post_id', postId)
        .order('created_at', { ascending: true }),
      [],
    );
    const views = new Map<string, CommentView>();
    for (const row of rows) {
      views.set(row.id, {
        id: row.id,
        postId: row.post_id,
        authorId: row.author_id,
        parentId: row.parent_id ?? null,
        content: row.content,
        createdAt: row.created_at,
        deletedAt: row.deleted_at ?? null,
        author: toUser(row.author),
        replies: [],
      });
    }
    const roots: CommentView[] = [];
    for (const view of views.values()) {
      if (view.parentId && views.has(view.parentId)) views.get(view.parentId)!.replies.push(view);
      else roots.push(view);
    }
    return roots;
  }

  async getComment(commentId: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('comments').select('id,author_id,post_id,parent_id').eq('id', commentId).limit(1),
      [],
    );
    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      authorId: rows[0].author_id,
      postId: rows[0].post_id,
      parentId: rows[0].parent_id ?? null,
    };
  }

  async deleteComment(commentId: string) {
    await this.maybe(this.db.from('comments').update({ deleted_at: iso() }).eq('id', commentId), null);
  }

  async countComments() {
    const { count } = await this.db
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null);
    return count ?? 0;
  }

  // ---------------------------------------------------------------- stories
  private toStory(row: Row, viewerId: string | null): Story {
    const views = (row.story_views ?? []) as Row[];
    const reactions = (row.story_reactions ?? []) as Row[];
    return {
      id: row.id,
      authorId: row.author_id,
      mediaUrl: row.media_url ?? null,
      mediaType: row.media_type ?? null,
      caption: row.caption ?? null,
      background: row.background ?? null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      viewCount: views.length,
      viewed: Boolean(viewerId && views.some((v) => v.viewer_id === viewerId)),
      reaction: viewerId ? reactions.find((r) => r.user_id === viewerId)?.emoji ?? null : null,
    };
  }

  async createStory(input: CreateStoryInput) {
    const rows = await this.run<Row[]>(
      this.db
        .from('stories')
        .insert({
          author_id: input.authorId,
          media_url: input.mediaUrl ?? null,
          media_type: input.mediaType ?? null,
          caption: input.caption ?? null,
          background: input.background ?? null,
        })
        .select('*'),
    );
    return this.toStory({ ...rows[0], story_views: [], story_reactions: [] }, input.authorId);
  }

  async listStoryGroups(viewerId: string | null) {
    const rel = await this.rel(viewerId);
    const rows = await this.maybe<Row[]>(
      this.db
        .from('stories')
        .select(`*, author:users!stories_author_id_fkey(${USER_SELECT}),story_views(viewer_id),story_reactions(user_id,emoji)`)
        .gt('expires_at', iso())
        .order('created_at', { ascending: true }),
      [],
    );
    const visible = rows.filter((row) => {
      if (viewerId && row.author_id === viewerId) return true;
      if (viewerId && rel.blocked.has(row.author_id)) return false;
      return rel.friends.has(row.author_id) || rel.following.has(row.author_id);
    });
    const groups = new Map<string, StoryGroup>();
    for (const row of visible) {
      const author = toUser(row.author);
      const story = this.toStory(row, viewerId);
      const existing = groups.get(row.author_id);
      if (existing) existing.stories.push(story);
      else groups.set(row.author_id, { author, stories: [story], allViewed: true });
    }
    for (const group of groups.values()) group.allViewed = group.stories.every((s) => s.viewed);
    return [...groups.values()].sort((a, b) => {
      if (a.author.id === viewerId) return -1;
      if (b.author.id === viewerId) return 1;
      return Number(a.allViewed) - Number(b.allViewed);
    });
  }

  async getStory(storyId: string, viewerId: string | null) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('stories')
        .select('*,story_views(viewer_id),story_reactions(user_id,emoji)')
        .eq('id', storyId)
        .limit(1),
      [],
    );
    return rows[0] ? this.toStory(rows[0], viewerId) : null;
  }

  async viewStory(storyId: string, viewerId: string) {
    await this.maybe(
      this.db
        .from('story_views')
        .upsert({ story_id: storyId, viewer_id: viewerId }, { onConflict: 'story_id,viewer_id' }),
      null,
    );
  }

  async listStoryViewers(storyId: string) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('story_views')
        .select(`viewer:users!story_views_viewer_id_fkey(${USER_SELECT}),created_at`)
        .eq('story_id', storyId)
        .order('created_at', { ascending: false }),
      [],
    );
    return rows.map((r) => toUser(r.viewer)).filter(Boolean);
  }

  async reactToStory(storyId: string, userId: string, emoji: string) {
    const story = await this.getStory(storyId, userId);
    if (!story) throw new Error('Story not found');
    await this.run(
      this.db
        .from('story_reactions')
        .upsert({ story_id: storyId, user_id: userId, emoji }, { onConflict: 'story_id,user_id' }),
    );
    return { authorId: story.authorId, caption: story.caption };
  }

  async countStories() {
    const { count } = await this.db
      .from('stories')
      .select('id', { count: 'exact', head: true })
      .gt('expires_at', iso());
    return count ?? 0;
  }

  // --------------------------------------------------------------- messaging
  async getOrCreateConversation(a: string, b: string) {
    const [userA, userB] = [a, b].sort();
    const existing = await this.maybe<Row[]>(
      this.db.from('conversations').select('id').eq('user_a', userA).eq('user_b', userB).limit(1),
      [],
    );
    if (existing[0]) return { id: existing[0].id as string };
    const rows = await this.run<Row[]>(
      this.db.from('conversations').insert({ user_a: userA, user_b: userB }).select('id'),
    );
    return { id: rows[0].id as string };
  }

  async getConversation(conversationId: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('conversations').select('*').eq('id', conversationId).limit(1),
      [],
    );
    if (!rows[0]) return null;
    return { id: rows[0].id, userA: rows[0].user_a, userB: rows[0].user_b };
  }

  private toMessage(row: Row): MessageView {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      body: row.body ?? '',
      mediaUrl: row.media_url ?? null,
      mediaType: row.media_type ?? null,
      createdAt: row.created_at,
      readAt: row.read_at ?? null,
      sender: row.sender ? toUser(row.sender) : ({} as User),
    };
  }

  async listConversations(userId: string): Promise<ConversationView[]> {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('conversations')
        .select('*')
        .or(`user_a.eq.${userId},user_b.eq.${userId}`)
        .order('last_message_at', { ascending: false })
        .limit(50),
      [],
    );
    if (!rows.length) return [];
    const otherIds = rows.map((r) => (r.user_a === userId ? r.user_b : r.user_a));
    const convIds = rows.map((r) => r.id);
    const [users, messages, typing] = await Promise.all([
      this.maybe<Row[]>(this.db.from('users').select(USER_SELECT).in('id', otherIds), []),
      this.maybe<Row[]>(
        this.db.from('messages').select('*').in('conversation_id', convIds).order('created_at', { ascending: false }),
        [],
      ),
      this.maybe<Row[]>(this.db.from('typing_indicators').select('*').in('conversation_id', convIds), []),
    ]);
    const userMap = new Map(users.map((u) => [u.id, toUser(u)]));
    return rows.map((row) => {
      const otherId = row.user_a === userId ? row.user_b : row.user_a;
      const other = userMap.get(otherId) ?? ({} as User);
      const convMessages = messages.filter((m) => m.conversation_id === row.id);
      const last = convMessages[0] ?? null;
      const unread = convMessages.filter((m) => m.sender_id !== userId && !m.read_at).length;
      const isTyping = typing.some(
        (t) =>
          t.conversation_id === row.id &&
          t.user_id !== userId &&
          Date.now() - new Date(t.updated_at).getTime() < 6000,
      );
      return {
        id: row.id,
        other,
        lastMessage: last ? this.toMessage({ ...last, sender: users.find((u) => u.id === last.sender_id) }) : null,
        unreadCount: unread,
        updatedAt: last?.created_at ?? row.created_at,
        online: other.lastSeenAt ? Date.now() - new Date(other.lastSeenAt).getTime() < 120_000 : false,
        typing: isTyping,
      } satisfies ConversationView;
    });
  }

  async listMessages(conversationId: string, opts: { cursor?: string | null; limit: number }) {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    let builder = this.db
      .from('messages')
      .select(`*,sender:users!messages_sender_id_fkey(${USER_SELECT})`)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (opts.cursor) builder = builder.lt('created_at', opts.cursor);
    const rows = await this.maybe<Row[]>(builder, []);
    return rows.reverse().map((r) => this.toMessage(r));
  }

  async createMessage(input: {
    conversationId: string;
    senderId: string;
    body: string;
    mediaUrl?: string | null;
    mediaType?: MediaType | null;
  }) {
    const rows = await this.run<Row[]>(
      this.db
        .from('messages')
        .insert({
          conversation_id: input.conversationId,
          sender_id: input.senderId,
          body: input.body,
          media_url: input.mediaUrl ?? null,
          media_type: input.mediaType ?? null,
        })
        .select('*'),
    );
    await this.maybe(
      this.db.from('conversations').update({ last_message_at: iso() }).eq('id', input.conversationId),
      null,
    );
    await this.maybe(
      this.db
        .from('typing_indicators')
        .delete()
        .eq('conversation_id', input.conversationId)
        .eq('user_id', input.senderId),
      null,
    );
    const senders = await this.maybe<Row[]>(
      this.db.from('users').select(USER_SELECT).eq('id', input.senderId).limit(1),
      [],
    );
    return this.toMessage({ ...rows[0], sender: senders[0] });
  }

  async markConversationRead(conversationId: string, userId: string) {
    await this.maybe(
      this.db
        .from('messages')
        .update({ read_at: iso() })
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .is('read_at', null),
      null,
    );
  }

  async setTyping(conversationId: string, userId: string) {
    await this.maybe(
      this.db
        .from('typing_indicators')
        .upsert(
          { conversation_id: conversationId, user_id: userId, updated_at: iso() },
          { onConflict: 'conversation_id,user_id' },
        ),
      null,
    );
  }

  async typingUsers(conversationId: string, excludeUserId: string) {
    const since = new Date(Date.now() - 6000).toISOString();
    const rows = await this.maybe<Row[]>(
      this.db
        .from('typing_indicators')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .gt('updated_at', since),
      [],
    );
    return rows.map((r) => r.user_id).filter((id) => id !== excludeUserId);
  }

  async countUnreadMessages(userId: string) {
    const convs = await this.maybe<Row[]>(
      this.db.from('conversations').select('id').or(`user_a.eq.${userId},user_b.eq.${userId}`),
      [],
    );
    if (!convs.length) return 0;
    const { count } = await this.db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', convs.map((c) => c.id))
      .neq('sender_id', userId)
      .is('read_at', null);
    return count ?? 0;
  }

  async countMessages() {
    const { count } = await this.db.from('messages').select('id', { count: 'exact', head: true });
    return count ?? 0;
  }

  // ----------------------------------------------------------------- groups
  private async groupViews(rows: Row[], viewerId: string | null): Promise<Group[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const members = await this.maybe<Row[]>(
      this.db.from('group_members').select('group_id,user_id,role').in('group_id', ids),
      [],
    );
    return rows.map((row) => {
      const groupMembers = members.filter((m) => m.group_id === row.id);
      const mine = groupMembers.find((m) => m.user_id === viewerId);
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? null,
        coverUrl: row.cover_url ?? null,
        privacy: row.privacy,
        ownerId: row.owner_id,
        createdAt: row.created_at,
        memberCount: groupMembers.length,
        isMember: Boolean(mine),
        role: (mine?.role ?? null) as Group['role'],
      } satisfies Group;
    });
  }

  async createGroup(input: {
    name: string;
    description?: string | null;
    coverUrl?: string | null;
    privacy: 'public' | 'private';
    ownerId: string;
  }) {
    const rows = await this.run<Row[]>(
      this.db
        .from('groups')
        .insert({
          name: input.name,
          description: input.description ?? null,
          cover_url: input.coverUrl ?? null,
          privacy: input.privacy,
          owner_id: input.ownerId,
        })
        .select('*'),
    );
    await this.run(
      this.db.from('group_members').insert({ group_id: rows[0].id, user_id: input.ownerId, role: 'owner' }),
    );
    const [view] = await this.groupViews(rows, input.ownerId);
    return view;
  }

  async listGroups(opts: { query?: string; viewerId: string | null; limit: number }) {
    let builder = this.db.from('groups').select('*').order('created_at', { ascending: false }).limit(opts.limit);
    if (opts.query) builder = builder.ilike('name', `%${opts.query}%`);
    const rows = await this.maybe<Row[]>(builder, []);
    return this.groupViews(rows, opts.viewerId);
  }

  async getGroup(groupId: string, viewerId: string | null) {
    const rows = await this.maybe<Row[]>(this.db.from('groups').select('*').eq('id', groupId).limit(1), []);
    if (!rows[0]) return null;
    const [view] = await this.groupViews(rows, viewerId);
    return view ?? null;
  }

  async joinGroup(groupId: string, userId: string) {
    await this.maybe(
      this.db
        .from('group_members')
        .upsert({ group_id: groupId, user_id: userId, role: 'member' }, { onConflict: 'group_id,user_id' }),
      null,
    );
  }

  async leaveGroup(groupId: string, userId: string) {
    const group = await this.getGroup(groupId, userId);
    if (group?.ownerId === userId) throw new Error('Owners cannot leave their own group');
    await this.run(this.db.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId));
  }

  async listGroupMembers(groupId: string) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('group_members')
        .select(`role,user:users!group_members_user_id_fkey(${USER_SELECT})`)
        .eq('group_id', groupId),
      [],
    );
    return rows.map((r) => ({ user: toUser(r.user), role: r.role as 'owner' | 'admin' | 'member' }));
  }

  async setGroupRole(groupId: string, userId: string, role: 'admin' | 'member') {
    await this.run(
      this.db.from('group_members').update({ role }).eq('group_id', groupId).eq('user_id', userId),
    );
  }

  async deleteGroup(groupId: string) {
    await this.run(this.db.from('groups').delete().eq('id', groupId));
  }

  async countGroups() {
    const { count } = await this.db.from('groups').select('id', { count: 'exact', head: true });
    return count ?? 0;
  }

  // ------------------------------------------------------------ marketplace
  async createListing(input: CreateListingInput) {
    const rows = await this.run<Row[]>(
      this.db
        .from('marketplace_listings')
        .insert({
          seller_id: input.sellerId,
          title: input.title,
          description: input.description,
          price_cents: input.priceCents,
          currency: input.currency ?? 'USD',
          category: input.category,
          location: input.location ?? null,
          images: input.images ?? [],
        })
        .select('*'),
    );
    const seller = (await this.getUser(input.sellerId))!;
    return toListing(rows[0], seller);
  }

  async listListings(opts: {
    query?: string;
    category?: string;
    sellerId?: string;
    cursor?: string | null;
    limit: number;
  }): Promise<Paged<Listing>> {
    const limit = Math.min(Math.max(opts.limit, 1), 40);
    let builder = this.db
      .from('marketplace_listings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (opts.sellerId) builder = builder.eq('seller_id', opts.sellerId);
    else builder = builder.eq('status', 'active');
    if (opts.category) builder = builder.eq('category', opts.category);
    if (opts.query) builder = builder.or(`title.ilike.%${opts.query}%,description.ilike.%${opts.query}%`);
    if (opts.cursor) builder = builder.lt('created_at', opts.cursor);
    const rows = await this.maybe<Row[]>(builder, []);
    const page = rows.slice(0, limit);
    const sellerIds = [...new Set(page.map((r) => r.seller_id))];
    const sellers = await this.maybe<Row[]>(
      this.db.from('users').select(USER_SELECT).in('id', sellerIds.length ? sellerIds : ['00000000-0000-0000-0000-000000000000']),
      [],
    );
    const sellerMap = new Map(sellers.map((s) => [s.id, toUser(s)]));
    return {
      items: page.map((r) => toListing(r, sellerMap.get(r.seller_id) ?? ({} as User))),
      nextCursor: rows.length > limit ? page[page.length - 1]?.created_at ?? null : null,
    };
  }

  async getListing(listingId: string) {
    const rows = await this.maybe<Row[]>(
      this.db.from('marketplace_listings').select('*').eq('id', listingId).limit(1),
      [],
    );
    if (!rows[0]) return null;
    const seller = await this.getUser(rows[0].seller_id);
    return toListing(rows[0], seller ?? ({} as User));
  }

  async updateListing(
    listingId: string,
    patch: {
      title?: string;
      description?: string;
      priceCents?: number;
      category?: string;
      location?: string | null;
      images?: string[];
      status?: 'active' | 'sold';
    },
  ) {
    const columns: Row = {};
    if (patch.title !== undefined) columns.title = patch.title;
    if (patch.description !== undefined) columns.description = patch.description;
    if (patch.priceCents !== undefined) columns.price_cents = patch.priceCents;
    if (patch.category !== undefined) columns.category = patch.category;
    if (patch.location !== undefined) columns.location = patch.location;
    if (patch.images !== undefined) columns.images = patch.images;
    if (patch.status !== undefined) columns.status = patch.status;
    const rows = await this.run<Row[]>(
      this.db.from('marketplace_listings').update(columns).eq('id', listingId).select('*'),
    );
    if (!rows[0]) throw new Error('Listing not found');
    const seller = await this.getUser(rows[0].seller_id);
    return toListing(rows[0], seller ?? ({} as User));
  }

  async deleteListing(listingId: string) {
    await this.run(this.db.from('marketplace_listings').delete().eq('id', listingId));
  }

  async countListings() {
    const { count } = await this.db.from('marketplace_listings').select('id', { count: 'exact', head: true });
    return count ?? 0;
  }

  // ---------------------------------------------------------- notifications
  async notify(input: NotifyInput) {
    const stub: AppNotification = {
      id: '',
      userId: input.userId,
      type: input.type,
      actorId: input.actorId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      message: input.message,
      readAt: null,
      createdAt: iso(),
      actor: null,
    };
    if (input.actorId && input.actorId === input.userId) return stub;
    const rows = await this.run<Row[]>(
      this.db
        .from('notifications')
        .insert({
          user_id: input.userId,
          type: input.type,
          actor_id: input.actorId ?? null,
          entity_type: input.entityType ?? null,
          entity_id: input.entityId ?? null,
          message: input.message,
        })
        .select('*'),
    );
    const actor = input.actorId ? await this.getUser(input.actorId) : null;
    return {
      id: rows[0].id,
      userId: rows[0].user_id,
      type: rows[0].type,
      actorId: rows[0].actor_id ?? null,
      entityType: rows[0].entity_type ?? null,
      entityId: rows[0].entity_id ?? null,
      message: rows[0].message,
      readAt: rows[0].read_at ?? null,
      createdAt: rows[0].created_at,
      actor,
    } satisfies AppNotification;
  }

  async listNotifications(userId: string, limit: number) {
    const rows = await this.maybe<Row[]>(
      this.db
        .from('notifications')
        .select(`*,actor:users!notifications_actor_id_fkey(${USER_SELECT})`)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
      [],
    );
    return rows.map(
      (row) =>
        ({
          id: row.id,
          userId: row.user_id,
          type: row.type,
          actorId: row.actor_id ?? null,
          entityType: row.entity_type ?? null,
          entityId: row.entity_id ?? null,
          message: row.message,
          readAt: row.read_at ?? null,
          createdAt: row.created_at,
          actor: row.actor ? toUser(row.actor) : null,
        }) satisfies AppNotification,
    );
  }

  async markNotificationsRead(userId: string) {
    await this.maybe(
      this.db.from('notifications').update({ read_at: iso() }).eq('user_id', userId).is('read_at', null),
      null,
    );
  }

  async countUnreadNotifications(userId: string) {
    const { count } = await this.db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    return count ?? 0;
  }

  // ------------------------------------------------------------- moderation
  async createReport(input: {
    reporterId: string;
    targetType: Report['targetType'];
    targetId: string;
    reason: string;
    details?: string | null;
  }) {
    await this.run(
      this.db.from('reports').insert({
        reporter_id: input.reporterId,
        target_type: input.targetType,
        target_id: input.targetId,
        reason: input.reason,
        details: input.details ?? null,
      }),
    );
  }

  async listReports(status?: Report['status']) {
    let builder = this.db
      .from('reports')
      .select(`*,reporter:users!reports_reporter_id_fkey(${USER_SELECT})`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) builder = builder.eq('status', status);
    const rows = await this.maybe<Row[]>(builder, []);
    return rows.map(
      (row) =>
        ({
          id: row.id,
          reporterId: row.reporter_id,
          targetType: row.target_type,
          targetId: row.target_id,
          reason: row.reason,
          details: row.details ?? null,
          status: row.status,
          createdAt: row.created_at,
          resolvedAt: row.resolved_at ?? null,
          reporter: row.reporter ? toUser(row.reporter) : null,
        }) satisfies Report,
    );
  }

  async resolveReport(reportId: string, _adminId: string, status: 'resolved' | 'dismissed') {
    await this.run(
      this.db.from('reports').update({ status, resolved_at: iso() }).eq('id', reportId),
    );
  }

  async countOpenReports() {
    const { count } = await this.db
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');
    return count ?? 0;
  }

  async suspendUser(id: string, suspended: boolean) {
    await this.run(this.db.from('users').update({ suspended }).eq('id', id));
  }

  async adminStats(): Promise<AdminStats> {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const count = async (table: string, apply?: (b: any) => any) => {
      let builder = this.db.from(table).select('id', { count: 'exact', head: true });
      if (apply) builder = apply(builder);
      const { count: total } = await builder;
      return total ?? 0;
    };
    const [users, posts, comments, stories, messages, groups, listings, openReports, newUsers7d, posts7d] =
      await Promise.all([
        count('users'),
        count('posts', (b) => b.is('deleted_at', null)),
        count('comments', (b) => b.is('deleted_at', null)),
        count('stories', (b) => b.gt('expires_at', iso())),
        count('messages'),
        count('groups'),
        count('marketplace_listings'),
        count('reports', (b) => b.eq('status', 'open')),
        count('users', (b) => b.gt('created_at', weekAgo)),
        count('posts', (b) => b.gt('created_at', weekAgo).is('deleted_at', null)),
      ]);
    return {
      users,
      posts,
      comments,
      stories,
      messages,
      groups,
      listings,
      openReports,
      newUsers7d,
      posts7d,
      mode: 'supabase',
    };
  }

  async getSettings(): Promise<AppSettings> {
    const rows = await this.maybe<Row[]>(this.db.from('app_settings').select('*').eq('id', 1).limit(1), []);
    const row = rows[0];
    return {
      siteName: row?.site_name ?? 'TJ SOCIAL',
      tagline: row?.tagline ?? 'Connect. Share. Discover.',
      registrationOpen: row?.registration_open ?? true,
      maxUploadMb: row?.max_upload_mb ?? 25,
      maintenanceMessage: row?.maintenance_message ?? '',
    };
  }

  async updateSettings(patch: Partial<AppSettings>) {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    await this.run(
      this.db.from('app_settings').upsert({
        id: 1,
        site_name: next.siteName,
        tagline: next.tagline,
        registration_open: next.registrationOpen,
        max_upload_mb: next.maxUploadMb,
        maintenance_message: next.maintenanceMessage,
        updated_at: iso(),
      }),
    );
    return next;
  }

  // -------------------------------------------------------------- discovery
  async search(query: string, viewerId: string | null): Promise<SearchResults> {
    const q = query.trim();
    if (!q) return { users: [], posts: [], groups: [], listings: [] };
    const [userRows, postRows, groupRows, listingRows] = await Promise.all([
      this.maybe<Row[]>(
        this.db
          .from('users')
          .select(USER_SELECT)
          .eq('suspended', false)
          .or(`name.ilike.%${q}%,handle.ilike.%${q}%,username.ilike.%${q}%`)
          .limit(8),
        [],
      ),
      this.maybe<Row[]>(
        this.db
          .from('posts')
          .select('*')
          .is('deleted_at', null)
          .eq('visibility', 'public')
          .ilike('content', `%${q}%`)
          .order('created_at', { ascending: false })
          .limit(10),
        [],
      ),
      this.maybe<Row[]>(
        this.db
          .from('groups')
          .select('*')
          .or(`name.ilike.%${q}%,description.ilike.%${q}%`)
          .limit(6),
        [],
      ),
      this.maybe<Row[]>(
        this.db
          .from('marketplace_listings')
          .select('*')
          .eq('status', 'active')
          .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
          .limit(8),
        [],
      ),
    ]);
    const sellerIds = [...new Set(listingRows.map((r) => r.seller_id))];
    const sellers = sellerIds.length
      ? await this.maybe<Row[]>(this.db.from('users').select(USER_SELECT).in('id', sellerIds), [])
      : [];
    const sellerMap = new Map(sellers.map((s) => [s.id, toUser(s)]));
    return {
      users: userRows.map(toUser),
      posts: await this.hydratePosts(postRows, viewerId),
      groups: await this.groupViews(groupRows, viewerId),
      listings: listingRows.map((r) => toListing(r, sellerMap.get(r.seller_id) ?? ({} as User))),
    };
  }

  async trending() {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const rows = await this.maybe<Row[]>(
      this.db
        .from('posts')
        .select('*')
        .is('deleted_at', null)
        .eq('visibility', 'public')
        .is('group_id', null)
        .gt('created_at', since)
        .order('created_at', { ascending: false })
        .limit(40),
      [],
    );
    const hydrated = await this.hydratePosts(rows, null);
    const posts = hydrated
      .sort((a, b) => b.likeCount + b.commentCount * 2 - (a.likeCount + a.commentCount * 2))
      .slice(0, 5);
    const followRows = await this.maybe<Row[]>(this.db.from('follows').select('following_id'), []);
    const scores = new Map<string, number>();
    for (const row of followRows) scores.set(row.following_id, (scores.get(row.following_id) ?? 0) + 1);
    const users = await this.maybe<Row[]>(
      this.db.from('users').select(USER_SELECT).eq('suspended', false).limit(50),
      [],
    );
    const ranked = users
      .map(toUser)
      .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
      .slice(0, 5);
    return { posts, users: ranked };
  }
}
