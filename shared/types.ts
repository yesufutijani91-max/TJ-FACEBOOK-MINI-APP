/**
 * Shared domain types used by both the API server and the React client.
 * The API always returns these camelCase shapes; database column names never
 * leak to the client.
 */

export type Privacy = 'public' | 'friends' | 'private';
export type MediaType = 'image' | 'video';
export type Theme = 'light' | 'dark' | 'system';

export interface User {
  id: string;
  telegramId: string | null;
  handle: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  privacy: Privacy;
  isAdmin: boolean;
  suspended: boolean;
  theme: Theme | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface Media {
  id: string;
  url: string;
  type: MediaType;
  position: number;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  privacy: 'public' | 'private';
  ownerId: string;
  createdAt: string;
  memberCount: number;
  isMember: boolean;
  role: 'owner' | 'admin' | 'member' | null;
}

export interface Post {
  id: string;
  authorId: string;
  content: string;
  visibility: Privacy;
  groupId: string | null;
  sharedPostId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PostView extends Post {
  author: User;
  group: Group | null;
  media: Media[];
  likeCount: number;
  commentCount: number;
  shareCount: number;
  liked: boolean;
  saved: boolean;
  sharedPost: PostView | null;
}

export interface CommentView {
  id: string;
  postId: string;
  authorId: string;
  parentId: string | null;
  content: string;
  createdAt: string;
  deletedAt: string | null;
  author: User;
  replies: CommentView[];
}

export interface Story {
  id: string;
  authorId: string;
  mediaUrl: string | null;
  mediaType: MediaType | null;
  caption: string | null;
  background: string | null;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  viewed: boolean;
  reaction: string | null;
}

export interface StoryGroup {
  author: User;
  stories: Story[];
  allViewed: boolean;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  mediaUrl: string | null;
  mediaType: MediaType | null;
  createdAt: string;
  readAt: string | null;
  sender: User;
}

export interface ConversationView {
  id: string;
  other: User;
  lastMessage: MessageView | null;
  unreadCount: number;
  updatedAt: string;
  online: boolean;
  typing: boolean;
}

export interface Listing {
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
  seller: User;
}

export type NotificationType =
  | 'like'
  | 'comment'
  | 'reply'
  | 'friend_request'
  | 'friend_accept'
  | 'follow'
  | 'message'
  | 'group'
  | 'story'
  | 'story_reaction'
  | 'story_reply';

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  actorId: string | null;
  entityType: 'post' | 'comment' | 'story' | 'user' | 'group' | 'conversation' | 'listing' | null;
  entityId: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
  actor: User | null;
}

export interface Report {
  id: string;
  reporterId: string;
  targetType: 'post' | 'comment' | 'user' | 'story' | 'listing';
  targetId: string;
  reason: string;
  details: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
  reporter: User | null;
}

export interface FriendRequestView {
  id: string;
  user: User;
  createdAt: string;
}

export interface FriendState {
  status: 'none' | 'pending_out' | 'pending_in' | 'friends' | 'self' | 'blocked';
  friendshipId: string | null;
}

export interface ProfileView {
  user: User;
  postCount: number;
  friendCount: number;
  followerCount: number;
  followingCount: number;
  friendState: FriendState;
  isFollowing: boolean;
  canViewContent: boolean;
}

export interface AdminStats {
  users: number;
  posts: number;
  comments: number;
  stories: number;
  messages: number;
  groups: number;
  listings: number;
  openReports: number;
  newUsers7d: number;
  posts7d: number;
  mode: 'supabase' | 'local';
}

export interface AppSettings {
  siteName: string;
  tagline: string;
  registrationOpen: boolean;
  maxUploadMb: number;
  maintenanceMessage: string;
}

export interface FeatureFlags {
  telegram: boolean;
  devLogin: boolean;
  storage: 'supabase' | 'local';
  botUsername: string | null;
}

export interface SessionInfo {
  user: User | null;
  mode: 'supabase' | 'local';
  features: FeatureFlags;
}

export interface SearchResults {
  users: User[];
  posts: PostView[];
  groups: Group[];
  listings: Listing[];
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}

export type FeedScope = 'home' | 'latest' | 'profile' | 'group' | 'saved' | 'video';
