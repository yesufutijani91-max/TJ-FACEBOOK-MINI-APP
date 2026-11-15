import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PostView } from '../../shared/types';
import { Icon } from '../components/icons';
import { Avatar, EmptyState, Modal, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatCount, timeAgo } from '../lib/format';
import { useSession } from '../state/session';

export default function WatchPage() {
  const { toast } = useSession();
  const [posts, setPosts] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [active, setActive] = useState<PostView | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (nextCursor: string | null) => {
      if (nextCursor) setLoadingMore(true);
      else setLoading(true);
      try {
        const page = await api.feed({ scope: 'video', cursor: nextCursor });
        setPosts((current) => (nextCursor ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load videos', 'error');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && cursor && !loadingMore && !loading) void load(cursor);
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loading, loadingMore, load]);

  const toggleLike = async (post: PostView) => {
    try {
      const result = await api.like(post.id);
      const next = { ...post, liked: result.liked, likeCount: result.likeCount };
      setPosts((current) => current.map((item) => (item.id === post.id ? next : item)));
      setActive((current) => (current?.id === post.id ? next : current));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not update like', 'error');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-3 px-3 py-3 sm:px-4">
      <header className="card flex items-center gap-3 px-4 py-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
          <Icon name="video" size={20} />
        </span>
        <div>
          <h1 className="text-base font-bold text-strong">Watch</h1>
          <p className="text-xs text-soft">Videos shared by people and groups you follow.</p>
        </div>
      </header>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="card overflow-hidden">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon="video"
          title="No videos yet"
          description="Upload a video from the composer on your home feed and it will appear here."
          action={
            <Link to="/" className="btn btn-primary">
              Go to feed
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => {
              const video = post.media.find((item) => item.type === 'video');
              const thumb = post.media.find((item) => item.type === 'image');
              return (
                <article key={post.id} className="card overflow-hidden">
                  <button className="relative block w-full" onClick={() => setActive(post)}>
                    {thumb ? (
                      <img src={thumb.url} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid aspect-video w-full place-items-center bg-[var(--surface-muted)]">
                        <video src={video?.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      </div>
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-black/25 text-white opacity-0 transition hover:opacity-100">
                      <Icon name="play" size={40} filled />
                    </span>
                  </button>
                  <div className="space-y-2 p-3">
                    <p className="clamp-2 text-sm font-semibold text-strong">{post.content || 'Untitled video'}</p>
                    <div className="flex items-center gap-2">
                      <Avatar user={post.author} size={26} />
                      <Link to={`/u/${post.author.id}`} className="truncate text-xs font-medium text-soft hover:underline">
                        {post.author.name}
                      </Link>
                      <span className="ml-auto text-[0.7rem] text-soft">{timeAgo(post.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-soft">
                      <button className="inline-flex items-center gap-1 hover:text-brand-600" onClick={() => void toggleLike(post)}>
                        <Icon name="heart" size={15} filled={post.liked} className={post.liked ? 'text-rose-500' : ''} />
                        {formatCount(post.likeCount)}
                      </button>
                      <Link to={`/post/${post.id}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                        <Icon name="comment" size={15} /> {formatCount(post.commentCount)}
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div ref={sentinel} />
          {loadingMore && (
            <div className="flex justify-center py-4 text-soft">
              <Spinner />
            </div>
          )}
        </>
      )}

      <Modal open={Boolean(active)} onClose={() => setActive(null)} title={active?.author.name ?? 'Video'}>
        {active && (
          <div className="space-y-3">
            {active.media
              .filter((item) => item.type === 'video')
              .map((item) => (
                <video key={item.id} src={item.url} className="max-h-[60vh] w-full rounded-xl bg-black" controls autoPlay playsInline />
              ))}
            {active.content && <p className="text-sm text-strong">{active.content}</p>}
            <div className="flex items-center gap-3">
              <button
                className={`btn ${active.liked ? 'btn-primary' : 'btn-soft'}`}
                onClick={() => void toggleLike(active)}
              >
                <Icon name="heart" size={16} filled={active.liked} /> {formatCount(active.likeCount)}
              </button>
              <Link to={`/post/${active.id}`} className="btn btn-soft" onClick={() => setActive(null)}>
                <Icon name="comment" size={16} /> Comments
              </Link>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
