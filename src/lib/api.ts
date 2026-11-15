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
  Paged,
  PostView,
  Privacy,
  ProfileView,
  Report,
  SearchResults,
  SessionInfo,
  Story,
  StoryGroup,
  User,
} from '../../shared/types';

const TOKEN_KEY = 'tj.social.token';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string | null) => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
  },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError('Network unavailable — check your connection and retry.', 0);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    const message = extractError(data) ?? `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

function extractError(data: unknown): string | null {
  if (data && typeof data === 'object' && 'error' in data) {
    const value = (data as { error: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const qs = (params: Record<string, string | number | null | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
};

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export interface AuthResult {
  user: User;
  token: string;
  expiresAt: string;
}

export interface UploadResult {
  url: string;
  type: MediaType;
  key: string;
  size?: number;
}

export interface TrendingResult {
  posts: PostView[];
  users: User[];
  tags: string[];
}

export interface PageWithFlag<T> extends Paged<T> {
  private?: boolean;
}

export const api = {
  // ------------------------------------------------------------------ session
  session: () => request<SessionInfo>('/api/session'),
  loginTelegram: (initData: string) =>
    request<AuthResult>('/api/auth/telegram', json({ initData })),
  loginGuest: (name?: string) => request<AuthResult>('/api/auth/guest', json({ name })),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  updateMe: (patch: {
    name?: string;
    handle?: string;
    username?: string;
    avatarUrl?: string | null;
    coverUrl?: string | null;
    bio?: string | null;
    location?: string | null;
    website?: string | null;
    privacy?: Privacy;
    theme?: 'light' | 'dark' | 'system';
  }) => request<{ user: User }>('/api/me', { method: 'PATCH', body: JSON.stringify(patch) }),

  // ------------------------------------------------------------------ people
  profile: (id: string) => request<ProfileView>(`/api/users/${id}`),
  userPosts: (id: string, cursor?: string | null) =>
    request<PageWithFlag<PostView>>(`/api/users/${id}/posts${qs({ cursor })}`),
  friends: () => request<{ items: User[] }>('/api/me/friends'),
  friendRequests: () =>
    request<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }>('/api/me/friend-requests'),
  blocked: () => request<{ items: User[] }>('/api/me/blocked'),
  suggestions: (limit = 8) => request<{ items: User[] }>(`/api/people/suggestions${qs({ limit })}`),
  follow: (id: string) => request<{ following: boolean }>(`/api/users/${id}/follow`, { method: 'POST' }),
  unfollow: (id: string) => request<{ following: boolean }>(`/api/users/${id}/follow`, { method: 'DELETE' }),
  sendFriendRequest: (id: string) =>
    request<FriendState>(`/api/users/${id}/friend-request`, { method: 'POST' }),
  respondFriendRequest: (id: string, accept: boolean) =>
    request<{ requesterId: string; accepted: boolean }>(`/api/friendships/${id}/respond`, json({ accept })),
  removeFriendship: (id: string) => request<{ ok: boolean }>(`/api/friendships/${id}`, { method: 'DELETE' }),
  block: (id: string) => request<{ blocked: boolean }>(`/api/users/${id}/block`, { method: 'POST' }),
  unblock: (id: string) => request<{ blocked: boolean }>(`/api/users/${id}/block`, { method: 'DELETE' }),

  // -------------------------------------------------------------------- feed
  feed: (params: { scope?: FeedScope; cursor?: string | null; authorId?: string; groupId?: string } = {}) =>
    request<Paged<PostView>>(`/api/feed${qs(params as Record<string, string>)}`),
  createPost: (input: {
    content: string;
    media?: { url: string; type: MediaType }[];
    visibility?: Privacy;
    groupId?: string | null;
    sharedPostId?: string | null;
  }) => request<{ post: PostView }>('/api/posts', json(input)),
  post: (id: string) => request<{ post: PostView }>(`/api/posts/${id}`),
  updatePost: (id: string, content: string) =>
    request<{ post: PostView }>(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify({ content }) }),
  deletePost: (id: string) => request<{ ok: boolean }>(`/api/posts/${id}`, { method: 'DELETE' }),
  like: (id: string) => request<{ liked: boolean; likeCount: number }>(`/api/posts/${id}/like`, { method: 'POST' }),
  save: (id: string) => request<{ saved: boolean }>(`/api/posts/${id}/save`, { method: 'POST' }),
  share: (id: string) => request<{ post: PostView }>(`/api/posts/${id}/share`, { method: 'POST' }),
  comments: (id: string) => request<{ items: CommentView[] }>(`/api/posts/${id}/comments`),
  addComment: (id: string, content: string, parentId?: string | null) =>
    request<{ comment: CommentView }>(`/api/posts/${id}/comments`, json({ content, parentId })),
  deleteComment: (id: string) => request<{ ok: boolean }>(`/api/comments/${id}`, { method: 'DELETE' }),
  report: (input: {
    targetType: 'post' | 'comment' | 'user' | 'story' | 'listing';
    targetId: string;
    reason: string;
    details?: string;
  }) => request<{ ok: boolean; message: string }>('/api/reports', json(input)),

  // ----------------------------------------------------------------- stories
  stories: () => request<{ items: StoryGroup[] }>('/api/stories'),
  createStory: (input: {
    mediaUrl?: string | null;
    mediaType?: MediaType | null;
    caption?: string;
    background?: string;
  }) => request<{ story: Story }>('/api/stories', json(input)),
  viewStory: (id: string) => request<{ ok: boolean }>(`/api/stories/${id}/view`, { method: 'POST' }),
  storyViewers: (id: string) =>
    request<{ items: { user: User; createdAt: string }[] }>(`/api/stories/${id}/viewers`),
  reactStory: (id: string, emoji: string) =>
    request<{ ok: boolean }>(`/api/stories/${id}/react`, json({ emoji })),
  replyStory: (id: string, message: string) =>
    request<{ ok: boolean; conversationId: string; message: MessageView }>(
      `/api/stories/${id}/reply`,
      json({ message }),
    ),

  // ------------------------------------------------------------------- media
  upload: (file: File, onProgress?: (percent: number) => void) => uploadFile(file, onProgress),

  // --------------------------------------------------------------- messaging
  conversations: () => request<{ items: ConversationView[] }>('/api/conversations'),
  openConversation: (userId: string) =>
    request<ConversationView>('/api/conversations', json({ userId })),
  messages: (conversationId: string, cursor?: string | null) =>
    request<{ items: MessageView[]; typing: User[] }>(
      `/api/conversations/${conversationId}/messages${qs({ cursor })}`,
    ),
  sendMessage: (
    conversationId: string,
    input: { body?: string; mediaUrl?: string | null; mediaType?: MediaType | null },
  ) => request<{ message: MessageView }>(`/api/conversations/${conversationId}/messages`, json(input)),
  markRead: (conversationId: string) =>
    request<{ ok: boolean }>(`/api/conversations/${conversationId}/read`, { method: 'POST' }),
  typing: (conversationId: string) =>
    request<{ ok: boolean }>(`/api/conversations/${conversationId}/typing`, { method: 'POST' }),
  badges: () => request<{ notifications: number; messages: number }>('/api/badges'),

  // ------------------------------------------------------------------ groups
  groups: (query?: string) => request<{ items: Group[] }>(`/api/groups${qs({ q: query })}`),
  createGroup: (input: { name: string; description?: string; privacy?: 'public' | 'private'; coverUrl?: string }) =>
    request<{ group: Group }>('/api/groups', json(input)),
  group: (id: string) => request<{ group: Group }>(`/api/groups/${id}`),
  joinGroup: (id: string) => request<{ joined: boolean }>(`/api/groups/${id}/join`, { method: 'POST' }),
  leaveGroup: (id: string) => request<{ joined: boolean }>(`/api/groups/${id}/join`, { method: 'DELETE' }),
  groupMembers: (id: string) =>
    request<{ items: { user: User; role: 'owner' | 'admin' | 'member' }[] }>(`/api/groups/${id}/members`),
  setGroupRole: (id: string, userId: string, role: 'admin' | 'member') =>
    request<{ ok: boolean }>(`/api/groups/${id}/members/${userId}/role`, json({ role })),
  deleteGroup: (id: string) => request<{ ok: boolean }>(`/api/groups/${id}`, { method: 'DELETE' }),
  groupPosts: (id: string, cursor?: string | null) =>
    request<Paged<PostView>>(`/api/groups/${id}/posts${qs({ cursor })}`),

  // ------------------------------------------------------------- marketplace
  listings: (params: { q?: string; category?: string; sellerId?: string; cursor?: string | null } = {}) =>
    request<Paged<Listing>>(`/api/listings${qs(params as Record<string, string>)}`),
  createListing: (input: {
    title: string;
    description?: string;
    priceCents: number;
    currency?: string;
    category?: string;
    location?: string;
    images?: string[];
  }) => request<{ listing: Listing }>('/api/listings', json(input)),
  listing: (id: string) => request<{ listing: Listing }>(`/api/listings/${id}`),
  updateListing: (id: string, patch: { status?: 'active' | 'sold'; title?: string; priceCents?: number }) =>
    request<{ listing: Listing }>(`/api/listings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteListing: (id: string) => request<{ ok: boolean }>(`/api/listings/${id}`, { method: 'DELETE' }),

  // ----------------------------------------------------------- notifications
  notifications: (limit = 40) =>
    request<{ items: AppNotification[] }>(`/api/notifications${qs({ limit })}`),
  readNotifications: () => request<{ ok: boolean }>('/api/notifications/read', { method: 'POST' }),

  // --------------------------------------------------------------- discovery
  search: (query: string) => request<SearchResults>(`/api/search${qs({ q: query })}`),
  trending: () => request<TrendingResult>('/api/trending'),

  // ------------------------------------------------------------------- admin
  adminStats: () => request<AdminStats>('/api/admin/stats'),
  adminUsers: (params: { q?: string; offset?: number; limit?: number } = {}) =>
    request<{ items: User[]; total: number }>(`/api/admin/users${qs(params as Record<string, string>)}`),
  adminSuspend: (id: string, suspended: boolean) =>
    request<{ user: User }>(`/api/admin/users/${id}/suspend`, json({ suspended })),
  adminReports: (status?: 'open' | 'resolved' | 'dismissed') =>
    request<{ items: Report[] }>(`/api/admin/reports${qs({ status })}`),
  adminResolveReport: (id: string, action: 'resolve' | 'dismiss') =>
    request<{ ok: boolean }>(`/api/admin/reports/${id}/resolve`, json({ action })),
  adminDeletePost: (id: string) => request<{ ok: boolean }>(`/api/admin/posts/${id}`, { method: 'DELETE' }),
  adminGroups: () => request<{ items: Group[] }>('/api/admin/groups'),
  adminDeleteGroup: (id: string) => request<{ ok: boolean }>(`/api/admin/groups/${id}`, { method: 'DELETE' }),
  adminSettings: () => request<{ settings: AppSettings }>('/api/admin/settings'),
  adminUpdateSettings: (patch: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
};

/** Uploads one file through the API with progress reporting. */
function uploadFile(file: File, onProgress?: (percent: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media');
    const token = tokenStore.get();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      const data = safeJson(xhr.responseText) as UploadResult | { error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300 && data && 'url' in data) {
        resolve(data as UploadResult);
      } else {
        const message = (data && 'error' in data && data.error) || 'Upload failed';
        reject(new ApiError(String(message), xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Upload failed — network error', 0));
    xhr.send(form);
  });
}

/** Subscribes to realtime server-sent events. Returns an unsubscribe function. */
export function subscribeEvents(handlers: {
  onMessage?: (payload: { conversationId: string; message: MessageView }) => void;
  onTyping?: (payload: { conversationId: string; userId: string }) => void;
  onNotification?: (payload: { notification: AppNotification }) => void;
  onRead?: (payload: { conversationId: string; userId: string }) => void;
}): () => void {
  const token = tokenStore.get();
  const url = `/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  let source: EventSource | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    source = new EventSource(url, { withCredentials: true });
    source.addEventListener('message', (event) => {
      const data = safeJson((event as MessageEvent).data) as
        | { conversationId: string; message: MessageView }
        | null;
      if (data?.message) handlers.onMessage?.(data);
    });
    source.addEventListener('typing', (event) => {
      const data = safeJson((event as MessageEvent).data) as
        | { conversationId: string; userId: string }
        | null;
      if (data) handlers.onTyping?.(data);
    });
    source.addEventListener('notification', (event) => {
      const data = safeJson((event as MessageEvent).data) as
        | { notification: AppNotification }
        | null;
      if (data?.notification) handlers.onNotification?.(data);
    });
    source.addEventListener('read', (event) => {
      const data = safeJson((event as MessageEvent).data) as
        | { conversationId: string; userId: string }
        | null;
      if (data) handlers.onRead?.(data);
    });
    source.onerror = () => {
      source?.close();
      if (!closed) setTimeout(connect, 4000);
    };
  };

  connect();
  return () => {
    closed = true;
    source?.close();
  };
}
