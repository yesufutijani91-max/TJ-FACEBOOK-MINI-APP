import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FeedScope, PostView, User } from '../../shared/types';
import { Composer } from '../components/Composer';
import { PostCard } from '../components/PostCard';
import { StoriesRail } from '../components/Stories';
import { Icon } from '../components/icons';
import { Avatar, EmptyState, Segmented, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../state/session';

function SuggestionCard({ person, onFollowed }: { person: User; onFollowed: (id: string) => void }) {
  const { toast } = useSession();
  const [pending, setPending] = useState(false);

  return (
    <div className="flex items-center gap-2.5 py-2">
      <Link to={`/u/${person.id}`}>
        <Avatar user={person} size={40} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/u/${person.id}`} className="block truncate text-sm font-semibold text-strong hover:underline">
          {person.name}
        </Link>
        <p className="truncate text-xs text-soft">@{person.handle}</p>
      </div>
      <button
        className="btn btn-soft px-2.5 py-1.5 text-xs"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            await api.sendFriendRequest(person.id);
            toast(`Friend request sent to ${person.name.split(' ')[0]}`, 'success');
            onFollowed(person.id);
          } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not send request', 'error');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? <Spinner size={13} /> : 'Add'}
      </button>
    </div>
  );
}

export default function HomePage() {
  const { user, toast } = useSession();
  const [scope, setScope] = useState<Extract<FeedScope, 'home' | 'latest' | 'video'>>('home');
  const [posts, setPosts] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const [trending, setTrending] = useState<{ posts: PostView[]; tags: string[] }>({ posts: [], tags: [] });
  const sentinel = useRef<HTMLDivElement | null>(null);

  const loadFeed = useCallback(
    async (nextScope: typeof scope, nextCursor: string | null) => {
      if (nextCursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const page = await api.feed({ scope: nextScope, cursor: nextCursor });
        setPosts((current) => (nextCursor ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load the feed', 'error');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    void loadFeed(scope, null);
  }, [scope, loadFeed]);

  useEffect(() => {
    api
      .suggestions(6)
      .then(({ items }) => setSuggestions(items))
      .catch(() => undefined);
    api
      .trending()
      .then((result) => setTrending({ posts: result.posts ?? [], tags: result.tags ?? [] }))
      .catch(() => undefined);
  }, []);

  // Infinite scrolling
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor && !loadingMore && !loading) {
          void loadFeed(scope, cursor);
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loading, loadingMore, scope, loadFeed]);

  const updatePost = (next: PostView) => setPosts((current) => current.map((item) => (item.id === next.id ? next : item)));

  return (
    <div className="mx-auto grid w-full max-w-[1180px] gap-6 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:px-0 lg:py-0">
      <div className="min-w-0 space-y-3">
        <StoriesRail />
        <Composer onCreated={(post) => setPosts((current) => [post, ...current])} />

        <div className="card px-3 py-2">
          <Segmented
            value={scope}
            onChange={(value) => setScope(value)}
            options={[
              { value: 'home', label: 'For you' },
              { value: 'latest', label: 'Latest' },
              { value: 'video', label: 'Videos' },
            ]}
          />
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="card space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-2.5 w-20" />
                  </div>
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-44 w-full rounded-2xl" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon="sparkle"
            title="Your feed is warming up"
            description="Follow people, join a group or publish your first post to fill this space."
            action={
              <Link to="/friends" className="btn btn-primary">
                Find friends
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onChange={updatePost} onDeleted={(id) => setPosts((current) => current.filter((item) => item.id !== id))} />
            ))}
            <div ref={sentinel} />
            {loadingMore && (
              <div className="flex justify-center py-4 text-soft">
                <Spinner />
              </div>
            )}
            {!cursor && posts.length > 0 && <p className="py-4 text-center text-xs text-soft">You're all caught up.</p>}
          </div>
        )}
      </div>

      <aside className="hidden space-y-3 lg:block">
        <div className="card px-4 py-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-bold text-strong">People you may know</h2>
            <Link to="/friends" className="text-xs font-semibold text-brand-600 hover:underline">
              See all
            </Link>
          </div>
          {suggestions.length === 0 ? (
            <p className="py-3 text-xs text-soft">No suggestions right now — invite a friend to TJ Social.</p>
          ) : (
            suggestions.map((person) => (
              <SuggestionCard key={person.id} person={person} onFollowed={(id) => setSuggestions((current) => current.filter((item) => item.id !== id))} />
            ))
          )}
        </div>

        <div className="card px-4 py-3">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-strong">
            <Icon name="trend" size={16} className="text-brand-600" /> Trending now
          </h2>
          {trending.tags.length === 0 && trending.posts.length === 0 ? (
            <p className="text-xs text-soft">Trending topics appear as the community gets active.</p>
          ) : (
            <div className="space-y-2">
              {trending.tags.slice(0, 5).map((tag) => (
                <Link key={tag} to={`/search?q=${encodeURIComponent(tag)}`} className="block text-sm font-semibold text-brand-600 hover:underline">
                  #{tag}
                </Link>
              ))}
              {trending.posts.slice(0, 2).map((post) => (
                <Link key={post.id} to={`/post/${post.id}`} className="clamp-2 block text-xs text-soft hover:text-strong">
                  {post.content || 'Media post'}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card px-4 py-3 text-xs text-soft">
          <p className="font-semibold text-strong">TJ Social</p>
          <p className="mt-1">Connect. Share. Discover. Built for Telegram, ready for the web.</p>
          <p className="mt-2">
            Signed in as <span className="font-semibold text-strong">{user?.name}</span>
          </p>
        </div>
      </aside>
    </div>
  );
}
