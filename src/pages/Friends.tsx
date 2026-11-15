import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FriendRequestView, User } from '../../shared/types';
import { Icon } from '../components/icons';
import { Avatar, ConfirmDialog, EmptyState, Field, Segmented, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useSession } from '../state/session';

type Tab = 'friends' | 'requests' | 'suggestions' | 'blocked';

function PersonRow({
  person,
  subtitle,
  children,
}: {
  person: User;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link to={`/u/${person.id}`}>
        <Avatar user={person} size={46} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/u/${person.id}`} className="block truncate text-sm font-semibold text-strong hover:underline">
          {person.name}
        </Link>
        <p className="truncate text-xs text-soft">{subtitle ?? `@${person.handle}`}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

export default function FriendsPage() {
  const { toast } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }>({
    incoming: [],
    outgoing: [],
  });
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [blocked, setBlocked] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<User | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [friendsRes, requestsRes, suggestionsRes, blockedRes] = await Promise.all([
        api.friends(),
        api.friendRequests(),
        api.suggestions(12),
        api.blocked(),
      ]);
      setFriends(friendsRes.items);
      setRequests(requestsRes);
      setSuggestions(suggestionsRes.items);
      setBlocked(blockedRes.items);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load your network', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const found = await api.search(term);
        if (active) setResults(found.users);
      } catch {
        /* ignore */
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const act = async (id: string, run: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    try {
      await run();
      toast(success, 'success');
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Action failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const addButton = (person: User) => (
    <button
      className="btn btn-primary px-3 py-1.5 text-xs"
      disabled={busyId === person.id}
      onClick={() => void act(person.id, () => api.sendFriendRequest(person.id), 'Friend request sent')}
    >
      {busyId === person.id ? <Spinner size={13} /> : 'Add friend'}
    </button>
  );

  const messageButton = (person: User) => (
    <button className="btn btn-soft px-3 py-1.5 text-xs" onClick={() => navigate(`/messages?to=${person.id}`)}>
      Message
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-3 sm:px-4">
      <div className="card p-3">
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soft" />
          <input
            className="input pl-9"
            placeholder="Search people by name or @handle"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {results ? (
        <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5">
            <h2 className="text-sm font-bold text-strong">People results</h2>
            <button className="text-xs font-semibold text-brand-600" onClick={() => setQuery('')}>
              Clear
            </button>
          </div>
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-soft">No one matches “{query}”.</p>
          ) : (
            results.map((person) => (
              <PersonRow key={person.id} person={person}>
                {messageButton(person)}
                {addButton(person)}
              </PersonRow>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="card px-3 py-2">
            <Segmented
              value={tab}
              onChange={(value) => setTab(value)}
              options={[
                { value: 'friends', label: `Friends${friends.length ? ` · ${friends.length}` : ''}` },
                { value: 'requests', label: `Requests${requests.incoming.length ? ` · ${requests.incoming.length}` : ''}` },
                { value: 'suggestions', label: 'Find' },
                { value: 'blocked', label: 'Blocked' },
              ]}
            />
          </div>

          {loading ? (
            <div className="card divide-y divide-[var(--border-subtle)]">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-11 w-11 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-2.5 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : tab === 'friends' ? (
            friends.length === 0 ? (
              <EmptyState
                icon="users"
                title="No friends yet"
                description="Send a request to someone in the Find tab — once they accept you'll see their posts in your feed."
                action={
                  <button className="btn btn-primary" onClick={() => setTab('suggestions')}>
                    Find people
                  </button>
                }
              />
            ) : (
              <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
                {friends.map((person) => (
                  <PersonRow key={person.id} person={person} subtitle={person.bio ?? `@${person.handle}`}>
                    {messageButton(person)}
                    <button
                      className="btn btn-ghost px-3 py-1.5 text-xs"
                      disabled={busyId === person.id}
                      onClick={() => setConfirmRemove(person)}
                    >
                      Remove
                    </button>
                  </PersonRow>
                ))}
              </div>
            )
          ) : tab === 'requests' ? (
            <div className="space-y-3">
              <div className="card overflow-hidden">
                <h2 className="border-b border-subtle px-4 py-2.5 text-sm font-bold text-strong">Incoming requests</h2>
                {requests.incoming.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-soft">No pending requests.</p>
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {requests.incoming.map((request) => (
                      <PersonRow key={request.id} person={request.user} subtitle={`Sent ${timeAgo(request.createdAt)}`}>
                        <button
                          className="btn btn-primary px-3 py-1.5 text-xs"
                          disabled={busyId === request.user.id}
                          onClick={() =>
                            void act(request.user.id, () => api.respondFriendRequest(request.user.id, true), 'Friend request accepted')
                          }
                        >
                          Accept
                        </button>
                        <button
                          className="btn btn-soft px-3 py-1.5 text-xs"
                          disabled={busyId === request.user.id}
                          onClick={() =>
                            void act(request.user.id, () => api.respondFriendRequest(request.user.id, false), 'Request declined')
                          }
                        >
                          Decline
                        </button>
                      </PersonRow>
                    ))}
                  </div>
                )}
              </div>
              <div className="card overflow-hidden">
                <h2 className="border-b border-subtle px-4 py-2.5 text-sm font-bold text-strong">Sent requests</h2>
                {requests.outgoing.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-soft">You have no outgoing requests.</p>
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {requests.outgoing.map((request) => (
                      <PersonRow key={request.id} person={request.user} subtitle={`Pending · ${timeAgo(request.createdAt)}`}>
                        <button
                          className="btn btn-ghost px-3 py-1.5 text-xs"
                          disabled={busyId === request.user.id}
                          onClick={() => void act(request.user.id, () => api.respondFriendRequest(request.user.id, false), 'Request cancelled')}
                        >
                          Cancel
                        </button>
                      </PersonRow>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : tab === 'suggestions' ? (
            suggestions.length === 0 ? (
              <EmptyState icon="sparkle" title="No suggestions right now" description="Invite a friend to TJ Social and start connecting." />
            ) : (
              <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
                {suggestions.map((person) => (
                  <PersonRow key={person.id} person={person}>
                    {addButton(person)}
                  </PersonRow>
                ))}
              </div>
            )
          ) : blocked.length === 0 ? (
            <EmptyState icon="lock" title="Nobody is blocked" description="Blocked accounts cannot message you, see your profile or interact with your posts." />
          ) : (
            <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
              {blocked.map((person) => (
                <PersonRow key={person.id} person={person}>
                  <button
                    className="btn btn-soft px-3 py-1.5 text-xs"
                    disabled={busyId === person.id}
                    onClick={() => void act(person.id, () => api.unblock(person.id), `${person.name} unblocked`)}
                  >
                    Unblock
                  </button>
                </PersonRow>
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title={confirmRemove ? `Remove ${confirmRemove.name}?` : ''}
        description="They won't be notified, and you can send a new request later."
        confirmLabel="Remove friend"
        destructive
        onCancel={() => setConfirmRemove(null)}
        onConfirm={async () => {
          if (!confirmRemove) return;
          await act(confirmRemove.id, () => api.removeFriendship(confirmRemove.id), 'Friend removed');
          setConfirmRemove(null);
        }}
      />
    </div>
  );
}
