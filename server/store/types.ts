import type {
  AdminStats,
  AppNotification,
  AppSettings,
  CommentView,
  ConversationView,
  FeedScope,
  FriendRequestView,
  FriendState,
  Group,
  Listing,
  MediaType,
  MessageView,
  NotificationType,
  Paged,
  Post,
  PostView,
  Privacy,
  Report,
  SearchResults,
  Story,
  StoryGroup,
  User,
} from '../../shared/types.js';

export interface CreateUserInput {
  telegramId?: string | null;
  handle?: string | null;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  isAdmin?: boolean;
}

export interface UserPatch {
  name?: string;
  handle?: string;
  username?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  privacy?: Privacy;
  theme?: 'light' | 'dark' | 'system' | null;
  lastSeenAt?: string;
  suspended?: boolean;
  isAdmin?: boolean;
}

export interface CreatePostInput {
  authorId: string;
  content: string;
  visibility?: Privacy;
  groupId?: string | null;
  sharedPostId?: string | null;
  media?: { url: string; type: MediaType }[];
}

export interface CreateStoryInput {
  authorId: string;
  mediaUrl?: string | null;
  mediaType?: MediaType | null;
  caption?: string | null;
  background?: string | null;
}

export interface CreateListingInput {
  sellerId: string;
  title: string;
  description: string;
  priceCents: number;
  category: string;
  location?: string | null;
  images?: string[];
  currency?: string;
}

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  actorId?: string | null;
  entityType?: AppNotification['entityType'];
  entityId?: string | null;
  message: string;
}

export interface FeedQuery {
  viewerId: string | null;
  scope: FeedScope;
  authorId?: string;
  groupId?: string;
  cursor?: string | null;
  limit: number;
}

/**
 * Persistence contract shared by the Supabase (Postgres) store and the
 * file-backed local store. Every method returns client-ready camelCase data.
 */
export interface Store {
  readonly kind: 'supabase' | 'local';
  init(): Promise<void>;

  // ---- users -------------------------------------------------------------
  getUser(id: string): Promise<User | null>;
  getUserByTelegramId(telegramId: string): Promise<User | null>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: string, patch: UserPatch): Promise<User>;
  touchUser(id: string): Promise<void>;
  searchUsers(query: string, limit: number): Promise<User[]>;
  suggestedUsers(viewerId: string | null, limit: number): Promise<User[]>;
  listUsers(opts: { query?: string; limit: number; offset: number }): Promise<User[]>;
  countUsers(): Promise<number>;

  // ---- relationships -----------------------------------------------------
  follow(followerId: string, followingId: string): Promise<void>;
  unfollow(followerId: string, followingId: string): Promise<void>;
  isFollowing(followerId: string, followingId: string): Promise<boolean>;
  listFollowers(userId: string): Promise<User[]>;
  listFollowing(userId: string): Promise<User[]>;
  countFollowers(userId: string): Promise<number>;
  countFollowing(userId: string): Promise<number>;

  friendState(viewerId: string, otherId: string): Promise<FriendState>;
  sendFriendRequest(fromId: string, toId: string): Promise<FriendState>;
  respondFriendRequest(friendshipId: string, userId: string, accept: boolean): Promise<{ requesterId: string; accepted: boolean }>;
  listFriends(userId: string): Promise<User[]>;
  listFriendRequests(userId: string): Promise<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }>;
  countFriends(userId: string): Promise<number>;
  mutualFriendCount(a: string, b: string): Promise<number>;

  blockUser(blockerId: string, blockedId: string): Promise<void>;
  unblockUser(blockerId: string, blockedId: string): Promise<void>;
  isBlocked(a: string, b: string): Promise<boolean>;
  listBlocked(userId: string): Promise<User[]>;

  // ---- posts -------------------------------------------------------------
  createPost(input: CreatePostInput): Promise<PostView>;
  getPost(postId: string): Promise<Post | null>;
  getPostView(postId: string, viewerId: string | null): Promise<PostView | null>;
  listFeed(query: FeedQuery): Promise<Paged<PostView>>;
  updatePost(postId: string, patch: { content?: string; visibility?: Privacy }): Promise<Post>;
  deletePost(postId: string): Promise<void>;
  toggleLike(postId: string, userId: string): Promise<{ liked: boolean; likeCount: number; authorId: string }>;
  toggleSave(postId: string, userId: string): Promise<{ saved: boolean }>;
  countPostsByAuthor(authorId: string): Promise<number>;
  countPosts(): Promise<number>;

  // ---- comments ----------------------------------------------------------
  createComment(input: { postId: string; authorId: string; parentId?: string | null; content: string }): Promise<CommentView>;
  listComments(postId: string, viewerId: string | null): Promise<CommentView[]>;
  getComment(commentId: string): Promise<{ id: string; authorId: string; postId: string; parentId: string | null } | null>;
  deleteComment(commentId: string): Promise<void>;
  countComments(): Promise<number>;

  // ---- stories -----------------------------------------------------------
  createStory(input: CreateStoryInput): Promise<Story>;
  listStoryGroups(viewerId: string | null): Promise<StoryGroup[]>;
  getStory(storyId: string, viewerId: string | null): Promise<Story | null>;
  viewStory(storyId: string, viewerId: string): Promise<void>;
  listStoryViewers(storyId: string): Promise<User[]>;
  reactToStory(storyId: string, userId: string, emoji: string): Promise<{ authorId: string; caption: string | null }>;
  countStories(): Promise<number>;

  // ---- messaging ---------------------------------------------------------
  getOrCreateConversation(a: string, b: string): Promise<{ id: string }>;
  getConversation(conversationId: string): Promise<{ id: string; userA: string; userB: string } | null>;
  listConversations(userId: string): Promise<ConversationView[]>;
  listMessages(conversationId: string, opts: { cursor?: string | null; limit: number }): Promise<MessageView[]>;
  createMessage(input: {
    conversationId: string;
    senderId: string;
    body: string;
    mediaUrl?: string | null;
    mediaType?: MediaType | null;
  }): Promise<MessageView>;
  markConversationRead(conversationId: string, userId: string): Promise<void>;
  setTyping(conversationId: string, userId: string): Promise<void>;
  typingUsers(conversationId: string, excludeUserId: string): Promise<string[]>;
  countUnreadMessages(userId: string): Promise<number>;
  countMessages(): Promise<number>;

  // ---- groups ------------------------------------------------------------
  createGroup(input: {
    name: string;
    description?: string | null;
    coverUrl?: string | null;
    privacy: 'public' | 'private';
    ownerId: string;
  }): Promise<Group>;
  listGroups(opts: { query?: string; viewerId: string | null; limit: number }): Promise<Group[]>;
  getGroup(groupId: string, viewerId: string | null): Promise<Group | null>;
  joinGroup(groupId: string, userId: string): Promise<void>;
  leaveGroup(groupId: string, userId: string): Promise<void>;
  listGroupMembers(groupId: string): Promise<{ user: User; role: 'owner' | 'admin' | 'member' }[]>;
  setGroupRole(groupId: string, userId: string, role: 'admin' | 'member'): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
  countGroups(): Promise<number>;

  // ---- marketplace -------------------------------------------------------
  createListing(input: CreateListingInput): Promise<Listing>;
  listListings(opts: {
    query?: string;
    category?: string;
    sellerId?: string;
    cursor?: string | null;
    limit: number;
  }): Promise<Paged<Listing>>;
  getListing(listingId: string): Promise<Listing | null>;
  updateListing(
    listingId: string,
    patch: { title?: string; description?: string; priceCents?: number; category?: string; location?: string | null; images?: string[]; status?: 'active' | 'sold' },
  ): Promise<Listing>;
  deleteListing(listingId: string): Promise<void>;
  countListings(): Promise<number>;

  // ---- notifications -----------------------------------------------------
  notify(input: NotifyInput): Promise<AppNotification>;
  listNotifications(userId: string, limit: number): Promise<AppNotification[]>;
  markNotificationsRead(userId: string): Promise<void>;
  countUnreadNotifications(userId: string): Promise<number>;

  // ---- moderation / admin ------------------------------------------------
  createReport(input: {
    reporterId: string;
    targetType: Report['targetType'];
    targetId: string;
    reason: string;
    details?: string | null;
  }): Promise<void>;
  listReports(status?: Report['status']): Promise<Report[]>;
  resolveReport(reportId: string, adminId: string, status: 'resolved' | 'dismissed'): Promise<void>;
  countOpenReports(): Promise<number>;
  adminStats(): Promise<AdminStats>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  // ---- discovery ---------------------------------------------------------
  search(query: string, viewerId: string | null): Promise<SearchResults>;
  trending(): Promise<{ posts: PostView[]; users: User[] }>;
}
