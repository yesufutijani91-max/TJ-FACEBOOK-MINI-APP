import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ConversationView, MessageView } from '../../shared/types';
import { Icon } from '../components/icons';
import { Avatar, EmptyState, Skeleton, Spinner } from '../components/ui';
import { api, subscribeEvents } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useSession } from '../state/session';

function DayDivider({ label }: { label: string }) {
  return <p className="my-3 text-center text-[0.68rem] font-semibold uppercase tracking-wide text-soft">{label}</p>;
}

export default function MessagesPage() {
  const { user, toast, refreshBadges } = useSession();
  const [params, setParams] = useSearchParams();
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(params.get('c'));
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [mobileThread, setMobileThread] = useState(Boolean(params.get('c') || params.get('to')));
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const typingTimer = useRef<number | null>(null);

  const active = useMemo(() => conversations.find((item) => item.id === activeId) ?? null, [conversations, activeId]);

  const loadConversations = useCallback(async () => {
    try {
      const { items } = await api.conversations();
      setConversations(items);
      return items;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load chats', 'error');
      return [];
    } finally {
      setLoadingList(false);
    }
  }, [toast]);

  const loadThread = useCallback(
    async (conversationId: string) => {
      setLoadingThread(true);
      try {
        const { items, typing } = await api.messages(conversationId);
        setMessages([...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        setTypingUsers(typing.map((person) => person.id));
        await api.markRead(conversationId);
        setConversations((current) => current.map((item) => (item.id === conversationId ? { ...item, unreadCount: 0 } : item)));
        void refreshBadges();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load messages', 'error');
      } finally {
        setLoadingThread(false);
      }
    },
    [refreshBadges, toast],
  );

  // Initial load + handle ?to=<userId> deep link.
  useEffect(() => {
    void (async () => {
      const list = await loadConversations();
      const target = params.get('to');
      if (target) {
        try {
          const conversation = await api.openConversation(target);
          setConversations((current) => {
            const exists = current.some((item) => item.id === conversation.id);
            return exists ? current.map((item) => (item.id === conversation.id ? conversation : item)) : [conversation, ...current];
          });
          setActiveId(conversation.id);
          setMobileThread(true);
          setParams({ c: conversation.id }, { replace: true });
        } catch (error) {
          toast(error instanceof Error ? error.message : 'Could not open chat', 'error');
        }
      } else if (!activeId && list.length > 0 && window.innerWidth >= 900) {
        setActiveId(list[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeId) void loadThread(activeId);
  }, [activeId, loadThread]);

  // Realtime: new messages, typing and read receipts.
  useEffect(() => {
    const unsubscribe = subscribeEvents({
      onMessage: ({ conversationId, message }) => {
        setConversations((current) => {
          const exists = current.some((item) => item.id === conversationId);
          const updated = current.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  lastMessage: message,
                  updatedAt: message.createdAt,
                  unreadCount: conversationId === activeId || message.senderId === user?.id ? 0 : item.unreadCount + 1,
                }
              : item,
          );
          updated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          if (!exists) void loadConversations();
          return updated;
        });
        if (message.conversationId === activeId) {
          setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
          if (message.senderId !== user?.id) void api.markRead(conversationId).catch(() => undefined);
        }
        void refreshBadges();
      },
      onTyping: ({ conversationId, userId }) => {
        if (conversationId !== activeId || userId === user?.id) return;
        setTypingUsers((current) => (current.includes(userId) ? current : [...current, userId]));
        window.setTimeout(() => setTypingUsers((current) => current.filter((id) => id !== userId)), 4000);
      },
      onRead: ({ conversationId, userId }) => {
        if (conversationId !== activeId || userId === user?.id) return;
        setMessages((current) => current.map((item) => (item.senderId === user?.id && !item.readAt ? { ...item, readAt: new Date().toISOString() } : item)));
      },
    });
    return unsubscribe;
  }, [activeId, loadConversations, refreshBadges, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typingUsers.length]);

  const open = (conversation: ConversationView) => {
    setActiveId(conversation.id);
    setMobileThread(true);
    setParams({ c: conversation.id }, { replace: true });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    setDraft('');
    try {
      const { message } = await api.sendMessage(activeId, { body });
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
      setConversations((current) =>
        current
          .map((item) => (item.id === activeId ? { ...item, lastMessage: message, updatedAt: message.createdAt } : item))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
    } catch (error) {
      setDraft(body);
      toast(error instanceof Error ? error.message : 'Message failed to send', 'error');
    } finally {
      setSending(false);
    }
  };

  const attach = async (file: File | undefined) => {
    if (!file || !activeId) return;
    setUploading(true);
    try {
      const uploaded = await api.upload(file);
      const { message } = await api.sendMessage(activeId, { body: draft.trim() || undefined, mediaUrl: uploaded.url, mediaType: uploaded.type });
      setDraft('');
      setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not send attachment', 'error');
    } finally {
      setUploading(false);
    }
  };

  const notifyTyping = () => {
    if (!activeId) return;
    if (typingTimer.current) return;
    void api.typing(activeId).catch(() => undefined);
    typingTimer.current = window.setTimeout(() => {
      typingTimer.current = null;
    }, 2500);
  };

  const filtered = conversations.filter((conversation) =>
    conversation.other.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const grouped = useMemo(() => {
    const buckets: { label: string; items: MessageView[] }[] = [];
    for (const message of messages) {
      const date = new Date(message.createdAt);
      const today = new Date();
      const label =
        date.toDateString() === today.toDateString()
          ? 'Today'
          : new Date(today.getTime() - 86400000).toDateString() === date.toDateString()
            ? 'Yesterday'
            : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const bucket = buckets.find((entry) => entry.label === label);
      if (bucket) bucket.items.push(message);
      else buckets.push({ label, items: [message] });
    }
    return buckets;
  }, [messages]);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-0 py-0 sm:px-4 sm:py-3">
      <div className="card grid h-[calc(100dvh-8.5rem)] overflow-hidden sm:h-[calc(100dvh-9rem)] md:grid-cols-[300px_minmax(0,1fr)]">
        <div className={`${mobileThread ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-subtle`}>
          <div className="space-y-2 border-b border-subtle p-3">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-bold text-strong">Messages</h1>
              <span className="text-xs text-soft">{conversations.length} chats</span>
            </div>
            <div className="relative">
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soft" />
              <input className="input py-2 pl-8 text-sm" placeholder="Search chats" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-2.5">
                    <Skeleton className="h-11 w-11 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-2.5 w-40" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-center text-sm text-soft">No conversations yet. Message someone from their profile.</p>
            ) : (
              filtered.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => open(conversation)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-[var(--surface-muted)] ${
                    conversation.id === activeId ? 'bg-brand-50 dark:bg-brand-500/10' : ''
                  }`}
                >
                  <div className="relative">
                    <Avatar user={conversation.other} size={44} />
                    {conversation.online && (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-[#0d1117]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-strong">{conversation.other.name}</p>
                      <span className="ml-auto shrink-0 text-[0.65rem] text-soft">{timeAgo(conversation.updatedAt)}</span>
                    </div>
                    <p className={`truncate text-xs ${conversation.unreadCount > 0 ? 'font-semibold text-strong' : 'text-soft'}`}>
                      {conversation.typing
                        ? 'typing…'
                        : conversation.lastMessage
                          ? `${conversation.lastMessage.senderId === user?.id ? 'You: ' : ''}${conversation.lastMessage.body || '📷 Attachment'}`
                          : 'Say hello'}
                    </p>
                  </div>
                  {conversation.unreadCount > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[0.65rem] font-bold text-white">
                      {conversation.unreadCount}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className={`${mobileThread ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}>
          {active ? (
            <>
              <div className="flex items-center gap-2 border-b border-subtle px-3 py-2.5">
                <button className="icon-btn md:hidden" onClick={() => setMobileThread(false)} aria-label="Back to chats">
                  <Icon name="back" size={18} />
                </button>
                <Link to={`/u/${active.other.id}`}>
                  <Avatar user={active.other} size={36} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/u/${active.other.id}`} className="block truncate text-sm font-semibold text-strong hover:underline">
                    {active.other.name}
                  </Link>
                  <p className="text-[0.68rem] text-soft">
                    {typingUsers.length > 0 ? 'typing…' : active.online ? 'Active now' : `@${active.other.handle}`}
                  </p>
                </div>
                <Link to={`/u/${active.other.id}`} className="icon-btn" aria-label="View profile">
                  <Icon name="user" size={18} />
                </Link>
              </div>

              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
                {loadingThread ? (
                  <div className="flex justify-center py-6 text-soft">
                    <Spinner />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="grid h-full place-items-center text-center">
                    <div>
                      <Avatar user={active.other} size={64} className="mx-auto" />
                      <p className="mt-3 text-sm font-semibold text-strong">{active.other.name}</p>
                      <p className="text-xs text-soft">This is the start of your conversation.</p>
                    </div>
                  </div>
                ) : (
                  grouped.map((bucket) => (
                    <div key={bucket.label}>
                      <DayDivider label={bucket.label} />
                      {bucket.items.map((message) => {
                        const mine = message.senderId === user?.id;
                        return (
                          <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                            <div className={`mb-1.5 max-w-[78%] ${mine ? 'items-end' : 'items-start'}`}>
                              <div
                                className={`overflow-hidden rounded-2xl px-3 py-2 text-sm ${
                                  mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-[var(--surface-muted)] text-strong'
                                }`}
                              >
                                {message.mediaUrl && message.mediaType === 'image' && (
                                  <img src={message.mediaUrl} alt="" className="mb-1 max-h-64 w-full rounded-lg object-cover" />
                                )}
                                {message.mediaUrl && message.mediaType === 'video' && (
                                  <video src={message.mediaUrl} className="mb-1 max-h-64 w-full rounded-lg" controls playsInline />
                                )}
                                {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
                              </div>
                              <p className={`mt-0.5 text-[0.62rem] text-soft ${mine ? 'text-right' : ''}`}>
                                {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                {mine && message.readAt && <span className="ml-1 text-brand-500">· Read</span>}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                {typingUsers.length > 0 && (
                  <div className="flex items-center gap-1 px-1 py-1 text-soft">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:240ms]" />
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <div className="flex items-end gap-2 border-t border-subtle p-2.5">
                <button className="icon-btn" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Attach media">
                  {uploading ? <Spinner size={16} /> : <Icon name="camera" size={20} />}
                </button>
                <textarea
                  className="input max-h-28 min-h-[42px] flex-1 resize-none py-2.5"
                  rows={1}
                  placeholder="Write a message…"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    notifyTyping();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <button className="btn btn-primary h-[42px] px-3" onClick={() => void send()} disabled={sending || !draft.trim()} aria-label="Send message">
                  {sending ? <Spinner size={16} /> : <Icon name="send" size={18} />}
                </button>
                <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(event) => void attach(event.target.files?.[0])} />
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center p-6">
              <EmptyState icon="chat" title="Select a conversation" description="Pick a chat on the left, or start a new one from someone's profile." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
