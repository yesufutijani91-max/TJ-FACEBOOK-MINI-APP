import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'user';

const DEFAULT_SETTINGS: AppSettings = {
  siteName: 'TJ SOCIAL',
  tagline: 'Connect. Share. Discover.',
  registrationOpen: true,
  maxUploadMb: 25,
  maintenanceMessage: '',
};

interface MediaRow {
  id: string;
  postId: string;
  url: string;
  type: MediaType;
  position: number;
}

interface CommentRow {
  id: string;
  postId: string;
  authorId: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  deletedAt: string | null;
}

interface StoryRow {
  id: string;
  authorId: string;
  mediaUrl: string | null;
  mediaType: MediaType | null;
  caption: string | null;
  background: string | null;
  createdAt: string;
  expiresAt: string;
}

interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  mediaUrl: string | null;
  mediaType: MediaType | null;
  createdAt: string;
  readAt: string | null;
}

interface ConversationRow {
  id: string;
  userA: string;
  userB: string;
  createdAt: string;
  lastMessageAt: string;
}

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  privacy: 'public' | 'private';
  ownerId: string;
  createdAt: string;
}

interface ListingRow {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  category: string;
  location: string | null;
  images: string[];
  status: 'active' | 'sold';
  createdAt: string;
}

interface DbFile {
  version: number;
  users: User[];
  follows: { followerId: string; followingId: string; createdAt: string }[];
  friendships: {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: 'pending' | 'accepted';
    createdAt: string;
    updatedAt: string;
  }[];
  blocks: { blockerId: string; blockedId: string; createdAt: string }[];
  posts: Post[];
  media: MediaRow[];
  likes: { postId: string; userId: string; createdAt: string }[];
  saves: { postId: string; userId: string; createdAt: string }[];
  comments: CommentRow[];
  stories: StoryRow[];
  storyViews: { storyId: string; viewerId: string; createdAt: string }[];
  storyReactions: { storyId: string; userId: string; emoji: string; createdAt: string }[];
  conversations: ConversationRow[];
  messages: MessageRow[];
  typing: { conversationId: string; userId: string; updatedAt: string }[];
  notifications: AppNotification[];
  groups: GroupRow[];
  groupMembers: { groupId: string; userId: string; role: 'owner' | 'admin' | 'member'; joinedAt: string }[];
  listings: ListingRow[];
  reports: Report[];
  settings: AppSettings;
}

function emptyDb(): DbFile {
  return {
    version: 1,
    users: [],
    follows: [],
    friendships: [],
    blocks: [],
    posts: [],
    media: [],
    likes: [],
    saves: [],
    comments: [],
    stories: [],
    storyViews: [],
    storyReactions: [],
    conversations: [],
    messages: [],
    typing: [],
    notifications: [],
    groups: [],
    groupMembers: [],
    listings: [],
    reports: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * File-backed store used for local development and for deployments where
 * Supabase has not been configured yet. Single-process, synchronous writes.
 */
export class LocalStore implements Store {
  readonly kind = 'local' as const;
  private db: DbFile;
  private readonly file: string;
  private dirty = false;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'tj-social.json');
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<DbFile>;
        this.db = { ...emptyDb(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) } };
      } catch {
        this.db = emptyDb();
      }
    } else {
      this.db = emptyDb();
      this.persist();
    }
  }

  async init(): Promise<void> {
    /* nothing to migrate for the file store */
  }

  private persist() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.db), 'utf8');
      this.dirty = false;
    } catch (error) {
      console.error('[local-store] persist failed', error);
    }
  }

  private save() {
    this.dirty = true;
    this.persist();
  }

  // ------------------------------------------------------------------ users
  private findUser(id: string | null | undefined): User | null {
    if (!id) return null;
    return this.db.users.find((u) => u.id === id) ?? null;
  }

  private requireUser(id: string): User {
    const user = this.findUser(id);
    if (!user) throw new Error('User not found');
    return user;
  }

  async getUser(id: string) {
    return this.findUser(id);
  }

  async getUserByTelegramId(telegramId: string) {
    return this.db.users.find((u) => u.telegramId === telegramId) ?? null;
  }

  private uniqueHandle(base: string, ignoreId?: string): string {
    const root = slugify(base);
    let candidate = root;
    let suffix = 1;
    while (this.db.users.some((u) => u.handle === candidate && u.id !== ignoreId)) {
      suffix += 1;
      candidate = `${root}${suffix}`;
    }
    return candidate;
  }

  async createUser(input: CreateUserInput) {
    const user: User = {
      id: uid(),
      telegramId: input.telegramId ?? null,
      handle: this.uniqueHandle(input.handle || input.name),
      name: input.name.trim() || 'New member',
      username: input.username ?? null,
      avatarUrl: input.avatarUrl ?? null,
      coverUrl: null,
      bio: null,
      location: null,
      website: null,
      privacy: 'public',
      // The first account of a fresh deployment owns the admin dashboard.
      isAdmin: input.isAdmin ?? this.db.users.length === 0,
      suspended: false,
      theme: null,
      createdAt: now(),
      lastSeenAt: now(),
    };
    this.db.users.push(user);
    this.save();
    return user;
  }

  async updateUser(id: string, patch: UserPatch) {
    const user = this.requireUser(id);
    if (patch.handle && patch.handle !== user.handle) {
      user.handle = this.uniqueHandle(patch.handle, user.id);
    }
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'handle') continue;
      if (value !== undefined) (user as unknown as Record<string, unknown>)[key] = value;
    }
    this.save();
    return user;
  }

  async touchUser(id: string) {
    const user = this.findUser(id);
    if (!user) return;
    user.lastSeenAt = now();
    this.dirty = true;
  }

  async searchUsers(query: string, limit: number) {
    const q = query.trim().toLowerCase();
    return this.db.users
      .filter((u) => !u.suspended)
      .filter(
        (u) =>
          !q ||
          u.name.toLowerCase().includes(q) ||
          u.handle.toLowerCase().includes(q) ||
          (u.username ?? '').toLowerCase().includes(q),
      )
      .slice(0, limit);
  }

  async suggestedUsers(viewerId: string | null, limit: number) {
    const rel = this.relations(viewerId);
    return this.db.users
      .filter((u) => !u.suspended && u.id !== viewerId && !rel.blocked.has(u.id))
      .filter((u) => !rel.friends.has(u.id) && !rel.following.has(u.id))
      .slice(0, limit);
  }

  async listUsers(opts: { query?: string; limit: number; offset: number }) {
    const q = (opts.query ?? '').trim().toLowerCase();
    const rows = this.db.users
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.handle.includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return rows.slice(opts.offset, opts.offset + opts.limit);
  }

  async countUsers() {
    return this.db.users.length;
  }

  // ---------------------------------------------------------- relationships
  private relations(viewerId: string | null) {
    const friends = new Set<string>();
    const following = new Set<string>();
    const blocked = new Set<string>();
    const groups = new Set<string>();
    if (!viewerId) return { friends, following, blocked, groups };
    for (const f of this.db.friendships) {
      if (f.status !== 'accepted') continue;
      if (f.requesterId === viewerId) friends.add(f.addresseeId);
      if (f.addresseeId === viewerId) friends.add(f.requesterId);
    }
    for (const f of this.db.follows) if (f.followerId === viewerId) following.add(f.followingId);
    for (const b of this.db.blocks) {
      if (b.blockerId === viewerId) blocked.add(b.blockedId);
      if (b.blockedId === viewerId) blocked.add(b.blockerId);
    }
    for (const m of this.db.groupMembers) if (m.userId === viewerId) groups.add(m.groupId);
    return { friends, following, blocked, groups };
  }

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) return;
    if (!this.db.follows.some((f) => f.followerId === followerId && f.followingId === followingId)) {
      this.db.follows.push({ followerId, followingId, createdAt: now() });
      this.save();
    }
  }

  async unfollow(followerId: string, followingId: string) {
    const before = this.db.follows.length;
    this.db.follows = this.db.follows.filter(
      (f) => !(f.followerId === followerId && f.followingId === followingId),
    );
    if (this.db.follows.length !== before) this.save();
  }

  async isFollowing(followerId: string, followingId: string) {
    return this.db.follows.some((f) => f.followerId === followerId && f.followingId === followingId);
  }

  async listFollowers(userId: string) {
    return this.db.follows
      .filter((f) => f.followingId === userId)
      .map((f) => this.findUser(f.followerId))
      .filter((u): u is User => Boolean(u));
  }

  async listFollowing(userId: string) {
    return this.db.follows
      .filter((f) => f.followerId === userId)
      .map((f) => this.findUser(f.followingId))
      .filter((u): u is User => Boolean(u));
  }

  async countFollowers(userId: string) {
    return this.db.follows.filter((f) => f.followingId === userId).length;
  }

  async countFollowing(userId: string) {
    return this.db.follows.filter((f) => f.followerId === userId).length;
  }

  private friendshipBetween(a: string, b: string) {
    return (
      this.db.friendships.find(
        (f) =>
          (f.requesterId === a && f.addresseeId === b) || (f.requesterId === b && f.addresseeId === a),
      ) ?? null
    );
  }

  async friendState(viewerId: string, otherId: string): Promise<FriendState> {
    if (viewerId === otherId) return { status: 'self', friendshipId: null };
    if (this.db.blocks.some((b) => b.blockerId === viewerId && b.blockedId === otherId)) {
      return { status: 'blocked', friendshipId: null };
    }
    const friendship = this.friendshipBetween(viewerId, otherId);
    if (!friendship) return { status: 'none', friendshipId: null };
    if (friendship.status === 'accepted') return { status: 'friends', friendshipId: friendship.id };
    return {
      status: friendship.requesterId === viewerId ? 'pending_out' : 'pending_in',
      friendshipId: friendship.id,
    };
  }

  async sendFriendRequest(fromId: string, toId: string) {
    if (fromId === toId) return this.friendState(fromId, toId);
    const existing = this.friendshipBetween(fromId, toId);
    if (existing) {
      if (existing.status === 'pending' && existing.requesterId === toId) {
        existing.status = 'accepted';
        existing.updatedAt = now();
        this.save();
      }
      return this.friendState(fromId, toId);
    }
    this.db.friendships.push({
      id: uid(),
      requesterId: fromId,
      addresseeId: toId,
      status: 'pending',
      createdAt: now(),
      updatedAt: now(),
    });
    this.save();
    return this.friendState(fromId, toId);
  }

  async respondFriendRequest(friendshipId: string, userId: string, accept: boolean) {
    const friendship = this.db.friendships.find((f) => f.id === friendshipId);
    if (!friendship) throw new Error('Friend request not found');
    if (friendship.addresseeId !== userId) throw new Error('Not allowed');
    if (accept) {
      friendship.status = 'accepted';
      friendship.updatedAt = now();
      this.save();
      return { requesterId: friendship.requesterId, accepted: true };
    }
    this.db.friendships = this.db.friendships.filter((f) => f.id !== friendshipId);
    this.save();
    return { requesterId: friendship.requesterId, accepted: false };
  }

  /** Cancels an outgoing request, declines an incoming one or unfriends. */
  async removeFriendship(friendshipId: string, userId: string) {
    const friendship = this.db.friendships.find((f) => f.id === friendshipId);
    if (!friendship) throw new Error('Friend request not found');
    if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
      throw new Error('Not allowed');
    }
    this.db.friendships = this.db.friendships.filter((f) => f.id !== friendshipId);
    this.save();
  }

  async listFriends(userId: string) {
    const ids = new Set<string>();
    for (const f of this.db.friendships) {
      if (f.status !== 'accepted') continue;
      if (f.requesterId === userId) ids.add(f.addresseeId);
      if (f.addresseeId === userId) ids.add(f.requesterId);
    }
    return [...ids].map((id) => this.findUser(id)).filter((u): u is User => Boolean(u));
  }

  async listFriendRequests(userId: string) {
    const incoming: FriendRequestView[] = [];
    const outgoing: FriendRequestView[] = [];
    for (const f of this.db.friendships) {
      if (f.status !== 'pending') continue;
      if (f.addresseeId === userId) {
        const user = this.findUser(f.requesterId);
        if (user) incoming.push({ id: f.id, user, createdAt: f.createdAt });
      } else if (f.requesterId === userId) {
        const user = this.findUser(f.addresseeId);
        if (user) outgoing.push({ id: f.id, user, createdAt: f.createdAt });
      }
    }
    return { incoming, outgoing };
  }

  async countFriends(userId: string) {
    return (await this.listFriends(userId)).length;
  }

  async mutualFriendCount(a: string, b: string) {
    const friendsA = new Set((await this.listFriends(a)).map((u) => u.id));
    const friendsB = await this.listFriends(b);
    return friendsB.filter((u) => friendsA.has(u.id)).length;
  }

  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) return;
    if (!this.db.blocks.some((b) => b.blockerId === blockerId && b.blockedId === blockedId)) {
      this.db.blocks.push({ blockerId, blockedId, createdAt: now() });
    }
    this.db.friendships = this.db.friendships.filter(
      (f) =>
        !(
          (f.requesterId === blockerId && f.addresseeId === blockedId) ||
          (f.requesterId === blockedId && f.addresseeId === blockerId)
        ),
    );
    this.db.follows = this.db.follows.filter(
      (f) =>
        !(
          (f.followerId === blockerId && f.followingId === blockedId) ||
          (f.followerId === blockedId && f.followingId === blockerId)
        ),
    );
    this.save();
  }

  async unblockUser(blockerId: string, blockedId: string) {
    this.db.blocks = this.db.blocks.filter(
      (b) => !(b.blockerId === blockerId && b.blockedId === blockedId),
    );
    this.save();
  }

  async isBlocked(a: string, b: string) {
    return this.db.blocks.some(
      (x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a),
    );
  }

  async listBlocked(userId: string) {
    return this.db.blocks
      .filter((b) => b.blockerId === userId)
      .map((b) => this.findUser(b.blockedId))
      .filter((u): u is User => Boolean(u));
  }

  // ------------------------------------------------------------------ posts
  private postMedia(postId: string) {
    return this.db.media
      .filter((m) => m.postId === postId)
      .sort((a, b) => a.position - b.position)
      .map((m) => ({ id: m.id, url: m.url, type: m.type, position: m.position }));
  }

  private hydratePost(post: Post, viewerId: string | null, depth = 0): PostView {
    const author = this.findUser(post.authorId);
    const likes = this.db.likes.filter((l) => l.postId === post.id);
    const comments = this.db.comments.filter((c) => c.postId === post.id && !c.deletedAt);
    const shares = this.db.posts.filter((p) => p.sharedPostId === post.id && !p.deletedAt);
    const group = post.groupId ? this.groupRow(post.groupId, viewerId) : null;
    const sharedSource = post.sharedPostId && depth === 0 ? this.findPost(post.sharedPostId) : null;
    return {
      ...post,
      author:
        author ??
        ({
          id: post.authorId,
          name: 'Deleted account',
          handle: 'deleted',
          telegramId: null,
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
          createdAt: post.createdAt,
          lastSeenAt: post.createdAt,
        } as User),
      group,
      media: this.postMedia(post.id),
      likeCount: likes.length,
      commentCount: comments.length,
      shareCount: shares.length,
      liked: viewerId ? likes.some((l) => l.userId === viewerId) : false,
      saved: viewerId ? this.db.saves.some((s) => s.postId === post.id && s.userId === viewerId) : false,
      sharedPost: sharedSource && !sharedSource.deletedAt ? this.hydratePost(sharedSource, viewerId, depth + 1) : null,
    };
  }

  private findPost(id: string) {
    return this.db.posts.find((p) => p.id === id) ?? null;
  }

  private canViewPost(post: Post, viewerId: string | null, rel = this.relations(viewerId)) {
    if (post.deletedAt) return false;
    const author = this.findUser(post.authorId);
    if (!author || author.suspended) return false;
    if (viewerId && author.id === viewerId) return true;
    if (viewerId && rel.blocked.has(author.id)) return false;
    if (post.groupId) {
      const group = this.db.groups.find((g) => g.id === post.groupId);
      if (!group) return false;
      if (group.privacy === 'public') return post.visibility !== 'private';
      return Boolean(viewerId && rel.groups.has(post.groupId));
    }
    if (post.visibility === 'public') return true;
    if (!viewerId) return false;
    if (post.visibility === 'friends') return rel.friends.has(author.id);
    return false;
  }

  async createPost(input: CreatePostInput) {
    const post: Post = {
      id: uid(),
      authorId: input.authorId,
      content: input.content,
      visibility: input.visibility ?? 'public',
      groupId: input.groupId ?? null,
      sharedPostId: input.sharedPostId ?? null,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    };
    this.db.posts.push(post);
    (input.media ?? []).forEach((item, index) => {
      this.db.media.push({ id: uid(), postId: post.id, url: item.url, type: item.type, position: index });
    });
    this.save();
    return this.hydratePost(post, input.authorId);
  }

  async getPost(postId: string) {
    return this.findPost(postId);
  }

  async getPostView(postId: string, viewerId: string | null) {
    const post = this.findPost(postId);
    if (!post || !this.canViewPost(post, viewerId)) return null;
    return this.hydratePost(post, viewerId);
  }

  async listFeed(query: FeedQuery): Promise<Paged<PostView>> {
    const rel = this.relations(query.viewerId);
    const limit = Math.min(Math.max(query.limit || 10, 1), 30);
    let rows: Post[] = this.db.posts.filter((p) => !p.deletedAt);

    switch (query.scope) {
      case 'home': {
        rows = rows.filter((p) => {
          if (p.groupId) return Boolean(query.viewerId && rel.groups.has(p.groupId));
          if (!query.viewerId) return p.visibility === 'public';
          const isSelf = p.authorId === query.viewerId;
          const isKnown =
            isSelf || rel.friends.has(p.authorId) || rel.following.has(p.authorId);
          return isKnown && this.canViewPost(p, query.viewerId, rel);
        });
        break;
      }
      case 'latest':
        rows = rows.filter((p) => !p.groupId && p.visibility === 'public' && this.canViewPost(p, query.viewerId, rel));
        break;
      case 'profile':
        rows = rows.filter((p) => p.authorId === query.authorId && this.canViewPost(p, query.viewerId, rel));
        break;
      case 'group':
        rows = rows.filter((p) => p.groupId === query.groupId && this.canViewPost(p, query.viewerId, rel));
        break;
      case 'saved': {
        const savedIds = new Set(
          this.db.saves.filter((s) => s.userId === query.viewerId).map((s) => s.postId),
        );
        rows = rows.filter((p) => savedIds.has(p.id) && this.canViewPost(p, query.viewerId, rel));
        break;
      }
      case 'video': {
        const videoPostIds = new Set(
          this.db.media.filter((m) => m.type === 'video').map((m) => m.postId),
        );
        rows = rows.filter(
          (p) => videoPostIds.has(p.id) && !p.groupId && this.canViewPost(p, query.viewerId, rel),
        );
        break;
      }
    }

    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (query.cursor) rows = rows.filter((p) => p.createdAt < query.cursor!);
    const page = rows.slice(0, limit);
    return {
      items: page.map((p) => this.hydratePost(p, query.viewerId)),
      nextCursor: rows.length > limit ? page[page.length - 1]?.createdAt ?? null : null,
    };
  }

  async updatePost(postId: string, patch: { content?: string; visibility?: 'public' | 'friends' | 'private' }) {
    const post = this.findPost(postId);
    if (!post) throw new Error('Post not found');
    if (patch.content !== undefined) post.content = patch.content;
    if (patch.visibility !== undefined) post.visibility = patch.visibility;
    post.updatedAt = now();
    this.save();
    return post;
  }

  async deletePost(postId: string) {
    const post = this.findPost(postId);
    if (!post) return;
    post.deletedAt = now();
    this.save();
  }

  async toggleLike(postId: string, userId: string) {
    const post = this.findPost(postId);
    if (!post) throw new Error('Post not found');
    const existing = this.db.likes.find((l) => l.postId === postId && l.userId === userId);
    if (existing) {
      this.db.likes = this.db.likes.filter((l) => !(l.postId === postId && l.userId === userId));
    } else {
      this.db.likes.push({ postId, userId, createdAt: now() });
    }
    this.save();
    return {
      liked: !existing,
      likeCount: this.db.likes.filter((l) => l.postId === postId).length,
      authorId: post.authorId,
    };
  }

  async toggleSave(postId: string, userId: string) {
    const existing = this.db.saves.find((s) => s.postId === postId && s.userId === userId);
    if (existing) {
      this.db.saves = this.db.saves.filter((s) => !(s.postId === postId && s.userId === userId));
      this.save();
      return { saved: false };
    }
    this.db.saves.push({ postId, userId, createdAt: now() });
    this.save();
    return { saved: true };
  }

  async countPostsByAuthor(authorId: string) {
    return this.db.posts.filter((p) => p.authorId === authorId && !p.deletedAt).length;
  }

  async countPosts() {
    return this.db.posts.filter((p) => !p.deletedAt).length;
  }

  // --------------------------------------------------------------- comments
  private hydrateComment(row: CommentRow): CommentView {
    const author = this.findUser(row.authorId);
    return {
      id: row.id,
      postId: row.postId,
      authorId: row.authorId,
      parentId: row.parentId,
      content: row.content,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
      author: author ?? (this.placeholderUser(row.authorId, row.createdAt) as User),
      replies: [],
    };
  }

  private placeholderUser(id: string, createdAt: string): User {
    return {
      id,
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
      createdAt,
      lastSeenAt: createdAt,
    };
  }

  async createComment(input: { postId: string; authorId: string; parentId?: string | null; content: string }) {
    const row: CommentRow = {
      id: uid(),
      postId: input.postId,
      authorId: input.authorId,
      parentId: input.parentId ?? null,
      content: input.content,
      createdAt: now(),
      deletedAt: null,
    };
    this.db.comments.push(row);
    this.save();
    return this.hydrateComment(row);
  }

  async listComments(postId: string, _viewerId: string | null) {
    const rows = this.db.comments
      .filter((c) => c.postId === postId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const byId = new Map<string, CommentView>();
    const roots: CommentView[] = [];
    for (const row of rows) {
      const view = this.hydrateComment(row);
      byId.set(view.id, view);
    }
    for (const row of rows) {
      const view = byId.get(row.id)!;
      if (row.parentId && byId.has(row.parentId)) {
        byId.get(row.parentId)!.replies.push(view);
      } else {
        roots.push(view);
      }
    }
    return roots;
  }

  async getComment(commentId: string) {
    const row = this.db.comments.find((c) => c.id === commentId);
    if (!row) return null;
    return { id: row.id, authorId: row.authorId, postId: row.postId, parentId: row.parentId };
  }

  async deleteComment(commentId: string) {
    const row = this.db.comments.find((c) => c.id === commentId);
    if (!row) return;
    row.deletedAt = now();
    this.save();
  }

  async countComments() {
    return this.db.comments.filter((c) => !c.deletedAt).length;
  }

  // ---------------------------------------------------------------- stories
  private storyView(row: StoryRow, viewerId: string | null): Story {
    const views = this.db.storyViews.filter((v) => v.storyId === row.id);
    const reaction = viewerId
      ? this.db.storyReactions.find((r) => r.storyId === row.id && r.userId === viewerId)
      : null;
    return {
      ...row,
      viewCount: views.length,
      viewed: viewerId ? views.some((v) => v.viewerId === viewerId) : false,
      reaction: reaction?.emoji ?? null,
    };
  }

  async createStory(input: CreateStoryInput) {
    const row: StoryRow = {
      id: uid(),
      authorId: input.authorId,
      mediaUrl: input.mediaUrl ?? null,
      mediaType: input.mediaType ?? null,
      caption: input.caption ?? null,
      background: input.background ?? null,
      createdAt: now(),
      expiresAt: new Date(Date.now() + DAY).toISOString(),
    };
    this.db.stories.push(row);
    this.save();
    return this.storyView(row, input.authorId);
  }

  async listStoryGroups(viewerId: string | null) {
    const rel = this.relations(viewerId);
    const active = this.db.stories.filter((s) => s.expiresAt > now());
    const visible = active.filter((s) => {
      if (viewerId && s.authorId === viewerId) return true;
      if (viewerId && rel.blocked.has(s.authorId)) return false;
      return (
        s.authorId === viewerId ||
        rel.friends.has(s.authorId) ||
        rel.following.has(s.authorId) ||
        (!viewerId && false)
      );
    });
    const groups = new Map<string, StoryGroup>();
    for (const row of visible.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const author = this.findUser(row.authorId);
      if (!author) continue;
      const view = this.storyView(row, viewerId);
      const existing = groups.get(row.authorId);
      if (existing) existing.stories.push(view);
      else groups.set(row.authorId, { author, stories: [view], allViewed: true });
    }
    for (const group of groups.values()) {
      group.allViewed = group.stories.every((s) => s.viewed);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.author.id === viewerId) return -1;
      if (b.author.id === viewerId) return 1;
      return Number(a.allViewed) - Number(b.allViewed);
    });
  }

  async getStory(storyId: string, viewerId: string | null) {
    const row = this.db.stories.find((s) => s.id === storyId);
    if (!row) return null;
    return this.storyView(row, viewerId);
  }

  async viewStory(storyId: string, viewerId: string) {
    if (this.db.storyViews.some((v) => v.storyId === storyId && v.viewerId === viewerId)) return;
    this.db.storyViews.push({ storyId, viewerId, createdAt: now() });
    this.save();
  }

  async listStoryViewers(storyId: string) {
    return this.db.storyViews
      .filter((v) => v.storyId === storyId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((v) => this.findUser(v.viewerId))
      .filter((u): u is User => Boolean(u));
  }

  async reactToStory(storyId: string, userId: string, emoji: string) {
    const story = this.db.stories.find((s) => s.id === storyId);
    if (!story) throw new Error('Story not found');
    this.db.storyReactions = this.db.storyReactions.filter(
      (r) => !(r.storyId === storyId && r.userId === userId),
    );
    this.db.storyReactions.push({ storyId, userId, emoji, createdAt: now() });
    this.save();
    return { authorId: story.authorId, caption: story.caption };
  }

  async countStories() {
    return this.db.stories.filter((s) => s.expiresAt > now()).length;
  }

  // --------------------------------------------------------------- messaging
  async getOrCreateConversation(a: string, b: string) {
    const [userA, userB] = [a, b].sort();
    const existing = this.db.conversations.find((c) => c.userA === userA && c.userB === userB);
    if (existing) return { id: existing.id };
    const row: ConversationRow = {
      id: uid(),
      userA,
      userB,
      createdAt: now(),
      lastMessageAt: now(),
    };
    this.db.conversations.push(row);
    this.save();
    return { id: row.id };
  }

  async getConversation(conversationId: string) {
    const row = this.db.conversations.find((c) => c.id === conversationId);
    return row ? { id: row.id, userA: row.userA, userB: row.userB } : null;
  }

  private messageView(row: MessageRow): MessageView {
    const sender = this.findUser(row.senderId);
    return {
      ...row,
      sender: sender ?? this.placeholderUser(row.senderId, row.createdAt),
    };
  }

  async listConversations(userId: string): Promise<ConversationView[]> {
    const rows = this.db.conversations.filter((c) => c.userA === userId || c.userB === userId);
    const views = rows.map((conv) => {
      const otherId = conv.userA === userId ? conv.userB : conv.userA;
      const other = this.findUser(otherId) ?? this.placeholderUser(otherId, conv.createdAt);
      const messages = this.db.messages
        .filter((m) => m.conversationId === conv.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const last = messages[messages.length - 1] ?? null;
      const unread = messages.filter((m) => m.senderId !== userId && !m.readAt).length;
      const typing = this.db.typing.some(
        (t) =>
          t.conversationId === conv.id &&
          t.userId !== userId &&
          Date.now() - new Date(t.updatedAt).getTime() < 6000,
      );
      return {
        id: conv.id,
        other,
        lastMessage: last ? this.messageView(last) : null,
        unreadCount: unread,
        updatedAt: last?.createdAt ?? conv.createdAt,
        online: Date.now() - new Date(other.lastSeenAt).getTime() < 120_000,
        typing,
      };
    });
    return views.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listMessages(conversationId: string, opts: { cursor?: string | null; limit: number }) {
    const limit = Math.min(Math.max(opts.limit, 1), 100);
    let rows = this.db.messages
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (opts.cursor) rows = rows.filter((m) => m.createdAt < opts.cursor!);
    const page = rows.slice(-limit);
    return page.map((m) => this.messageView(m));
  }

  async createMessage(input: {
    conversationId: string;
    senderId: string;
    body: string;
    mediaUrl?: string | null;
    mediaType?: MediaType | null;
  }) {
    const row: MessageRow = {
      id: uid(),
      conversationId: input.conversationId,
      senderId: input.senderId,
      body: input.body,
      mediaUrl: input.mediaUrl ?? null,
      mediaType: input.mediaType ?? null,
      createdAt: now(),
      readAt: null,
    };
    this.db.messages.push(row);
    const conv = this.db.conversations.find((c) => c.id === input.conversationId);
    if (conv) conv.lastMessageAt = row.createdAt;
    this.db.typing = this.db.typing.filter(
      (t) => !(t.conversationId === input.conversationId && t.userId === input.senderId),
    );
    this.save();
    return this.messageView(row);
  }

  async markConversationRead(conversationId: string, userId: string) {
    let changed = false;
    for (const message of this.db.messages) {
      if (message.conversationId === conversationId && message.senderId !== userId && !message.readAt) {
        message.readAt = now();
        changed = true;
      }
    }
    if (changed) this.save();
  }

  async setTyping(conversationId: string, userId: string) {
    const existing = this.db.typing.find(
      (t) => t.conversationId === conversationId && t.userId === userId,
    );
    if (existing) existing.updatedAt = now();
    else this.db.typing.push({ conversationId, userId, updatedAt: now() });
    this.save();
  }

  async typingUsers(conversationId: string, excludeUserId: string) {
    return this.db.typing
      .filter(
        (t) =>
          t.conversationId === conversationId &&
          t.userId !== excludeUserId &&
          Date.now() - new Date(t.updatedAt).getTime() < 6000,
      )
      .map((t) => t.userId);
  }

  async countUnreadMessages(userId: string) {
    const myConversations = new Set(
      this.db.conversations.filter((c) => c.userA === userId || c.userB === userId).map((c) => c.id),
    );
    return this.db.messages.filter(
      (m) => myConversations.has(m.conversationId) && m.senderId !== userId && !m.readAt,
    ).length;
  }

  async countMessages() {
    return this.db.messages.length;
  }

  // ----------------------------------------------------------------- groups
  private groupRow(groupId: string, viewerId: string | null): Group | null {
    const row = this.db.groups.find((g) => g.id === groupId);
    if (!row) return null;
    const members = this.db.groupMembers.filter((m) => m.groupId === groupId);
    const mine = viewerId ? members.find((m) => m.userId === viewerId) : undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      coverUrl: row.coverUrl,
      privacy: row.privacy,
      ownerId: row.ownerId,
      createdAt: row.createdAt,
      memberCount: members.length,
      isMember: Boolean(mine),
      role: mine?.role ?? null,
    };
  }

  async createGroup(input: {
    name: string;
    description?: string | null;
    coverUrl?: string | null;
    privacy: 'public' | 'private';
    ownerId: string;
  }) {
    const row: GroupRow = {
      id: uid(),
      name: input.name,
      description: input.description ?? null,
      coverUrl: input.coverUrl ?? null,
      privacy: input.privacy,
      ownerId: input.ownerId,
      createdAt: now(),
    };
    this.db.groups.push(row);
    this.db.groupMembers.push({ groupId: row.id, userId: input.ownerId, role: 'owner', joinedAt: now() });
    this.save();
    return this.groupRow(row.id, input.ownerId)!;
  }

  async listGroups(opts: { query?: string; viewerId: string | null; limit: number }) {
    const q = (opts.query ?? '').trim().toLowerCase();
    return this.db.groups
      .filter((g) => !q || g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts.limit)
      .map((g) => this.groupRow(g.id, opts.viewerId))
      .filter((g): g is Group => Boolean(g));
  }

  async getGroup(groupId: string, viewerId: string | null) {
    return this.groupRow(groupId, viewerId);
  }

  async joinGroup(groupId: string, userId: string) {
    if (this.db.groupMembers.some((m) => m.groupId === groupId && m.userId === userId)) return;
    this.db.groupMembers.push({ groupId, userId, role: 'member', joinedAt: now() });
    this.save();
  }

  async leaveGroup(groupId: string, userId: string) {
    const group = this.db.groups.find((g) => g.id === groupId);
    if (group?.ownerId === userId) throw new Error('Owners cannot leave their own group');
    this.db.groupMembers = this.db.groupMembers.filter(
      (m) => !(m.groupId === groupId && m.userId === userId),
    );
    this.save();
  }

  async listGroupMembers(groupId: string) {
    return this.db.groupMembers
      .filter((m) => m.groupId === groupId)
      .map((m) => {
        const user = this.findUser(m.userId);
        return user ? { user, role: m.role } : null;
      })
      .filter((row): row is { user: User; role: 'owner' | 'admin' | 'member' } => Boolean(row));
  }

  async setGroupRole(groupId: string, userId: string, role: 'admin' | 'member') {
    const member = this.db.groupMembers.find((m) => m.groupId === groupId && m.userId === userId);
    if (!member) throw new Error('Member not found');
    if (member.role === 'owner') throw new Error('Owner role cannot be changed');
    member.role = role;
    this.save();
  }

  async deleteGroup(groupId: string) {
    this.db.groups = this.db.groups.filter((g) => g.id !== groupId);
    this.db.groupMembers = this.db.groupMembers.filter((m) => m.groupId !== groupId);
    for (const post of this.db.posts) {
      if (post.groupId === groupId) post.deletedAt = now();
    }
    this.save();
  }

  async countGroups() {
    return this.db.groups.length;
  }

  // ------------------------------------------------------------ marketplace
  private listingView(row: ListingRow): Listing {
    const seller = this.findUser(row.sellerId);
    return { ...row, seller: seller ?? this.placeholderUser(row.sellerId, row.createdAt) };
  }

  async createListing(input: CreateListingInput) {
    const row: ListingRow = {
      id: uid(),
      sellerId: input.sellerId,
      title: input.title,
      description: input.description,
      priceCents: input.priceCents,
      currency: input.currency ?? 'USD',
      category: input.category,
      location: input.location ?? null,
      images: input.images ?? [],
      status: 'active',
      createdAt: now(),
    };
    this.db.listings.push(row);
    this.save();
    return this.listingView(row);
  }

  async listListings(opts: {
    query?: string;
    category?: string;
    sellerId?: string;
    cursor?: string | null;
    limit: number;
  }): Promise<Paged<Listing>> {
    const q = (opts.query ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(opts.limit, 1), 40);
    let rows = this.db.listings.filter((l) => l.status === 'active' || opts.sellerId === l.sellerId);
    if (opts.category) rows = rows.filter((l) => l.category === opts.category);
    if (opts.sellerId) rows = rows.filter((l) => l.sellerId === opts.sellerId);
    if (q) {
      rows = rows.filter(
        (l) => l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q),
      );
    }
    rows = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (opts.cursor) rows = rows.filter((l) => l.createdAt < opts.cursor!);
    const page = rows.slice(0, limit);
    return {
      items: page.map((l) => this.listingView(l)),
      nextCursor: rows.length > limit ? page[page.length - 1]?.createdAt ?? null : null,
    };
  }

  async getListing(listingId: string) {
    const row = this.db.listings.find((l) => l.id === listingId);
    return row ? this.listingView(row) : null;
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
    const row = this.db.listings.find((l) => l.id === listingId);
    if (!row) throw new Error('Listing not found');
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    this.save();
    return this.listingView(row);
  }

  async deleteListing(listingId: string) {
    this.db.listings = this.db.listings.filter((l) => l.id !== listingId);
    this.save();
  }

  async countListings() {
    return this.db.listings.length;
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
      createdAt: now(),
      actor: null,
    };
    if (input.actorId && input.actorId === input.userId) return stub;
    const row: AppNotification = {
      ...stub,
      id: uid(),
      actor: input.actorId ? this.findUser(input.actorId) : null,
    };
    this.db.notifications.unshift(row);
    if (this.db.notifications.length > 500) this.db.notifications.length = 500;
    this.save();
    return row;
  }

  async listNotifications(userId: string, limit: number) {
    return this.db.notifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((n) => ({ ...n, actor: n.actorId ? this.findUser(n.actorId) : null }));
  }

  async markNotificationsRead(userId: string) {
    let changed = false;
    for (const notification of this.db.notifications) {
      if (notification.userId === userId && !notification.readAt) {
        notification.readAt = now();
        changed = true;
      }
    }
    if (changed) this.save();
  }

  async countUnreadNotifications(userId: string) {
    return this.db.notifications.filter((n) => n.userId === userId && !n.readAt).length;
  }

  // ------------------------------------------------------------- moderation
  async createReport(input: {
    reporterId: string;
    targetType: Report['targetType'];
    targetId: string;
    reason: string;
    details?: string | null;
  }) {
    this.db.reports.unshift({
      id: uid(),
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      details: input.details ?? null,
      status: 'open',
      createdAt: now(),
      resolvedAt: null,
      reporter: this.findUser(input.reporterId),
    });
    this.save();
  }

  async listReports(status?: Report['status']) {
    return this.db.reports
      .filter((r) => !status || r.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r, reporter: this.findUser(r.reporterId) }));
  }

  async resolveReport(reportId: string, _adminId: string, status: 'resolved' | 'dismissed') {
    const report = this.db.reports.find((r) => r.id === reportId);
    if (!report) return;
    report.status = status;
    report.resolvedAt = now();
    this.save();
  }

  async countOpenReports() {
    return this.db.reports.filter((r) => r.status === 'open').length;
  }

  async suspendUser(id: string, suspended: boolean) {
    const user = this.findUser(id);
    if (!user) return;
    user.suspended = suspended;
    this.save();
  }

  async adminStats(): Promise<AdminStats> {
    const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
    return {
      users: this.db.users.length,
      posts: this.db.posts.filter((p) => !p.deletedAt).length,
      comments: this.db.comments.filter((c) => !c.deletedAt).length,
      stories: this.db.stories.filter((s) => s.expiresAt > now()).length,
      messages: this.db.messages.length,
      groups: this.db.groups.length,
      listings: this.db.listings.length,
      openReports: this.db.reports.filter((r) => r.status === 'open').length,
      newUsers7d: this.db.users.filter((u) => u.createdAt > weekAgo).length,
      posts7d: this.db.posts.filter((p) => p.createdAt > weekAgo && !p.deletedAt).length,
      mode: 'local',
    };
  }

  async getSettings() {
    return { ...DEFAULT_SETTINGS, ...this.db.settings };
  }

  async updateSettings(patch: Partial<AppSettings>) {
    this.db.settings = { ...DEFAULT_SETTINGS, ...this.db.settings, ...patch };
    this.save();
    return this.db.settings;
  }

  // -------------------------------------------------------------- discovery
  async search(query: string, viewerId: string | null): Promise<SearchResults> {
    const q = query.trim().toLowerCase();
    if (!q) return { users: [], posts: [], groups: [], listings: [] };
    const rel = this.relations(viewerId);
    const users = this.db.users
      .filter(
        (u) =>
          !u.suspended &&
          (u.name.toLowerCase().includes(q) ||
            u.handle.toLowerCase().includes(q) ||
            (u.username ?? '').toLowerCase().includes(q)),
      )
      .slice(0, 8);
    const posts = this.db.posts
      .filter((p) => !p.deletedAt && p.content.toLowerCase().includes(q) && this.canViewPost(p, viewerId, rel))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((p) => this.hydratePost(p, viewerId));
    const groups = this.db.groups
      .filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          (g.description ?? '').toLowerCase().includes(q),
      )
      .slice(0, 6)
      .map((g) => this.groupRow(g.id, viewerId))
      .filter((g): g is Group => Boolean(g));
    const listings = this.db.listings
      .filter(
        (l) =>
          l.status === 'active' &&
          (l.title.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)),
      )
      .slice(0, 8)
      .map((l) => this.listingView(l));
    return { users, posts, groups, listings };
  }

  async trending() {
    const since = new Date(Date.now() - 14 * DAY).toISOString();
    const posts = this.db.posts
      .filter((p) => !p.deletedAt && p.createdAt > since && p.visibility === 'public' && !p.groupId)
      .map((p) => this.hydratePost(p, null))
      .sort((a, b) => b.likeCount + b.commentCount * 2 - (a.likeCount + a.commentCount * 2))
      .slice(0, 5);
    const users = this.db.users
      .filter((u) => !u.suspended)
      .map((u) => ({ user: u, score: this.db.follows.filter((f) => f.followingId === u.id).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((entry) => entry.user);
    return { posts, users };
  }
}
