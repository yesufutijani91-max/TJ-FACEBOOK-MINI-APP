import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PostView } from '../../shared/types';
import { Icon } from '../components/icons';
import { PostCard } from '../components/PostCard';
import { EmptyState, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../state/session';

export default function PostDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useSession();
  const [post, setPost] = useState<PostView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .post(id)
      .then(({ post: found }) => {
        if (active) setPost(found);
      })
      .catch((problem: unknown) => {
        if (active) setError(problem instanceof Error ? problem.message : 'Post unavailable');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-3 py-3 sm:px-4">
      <button className="btn btn-ghost self-start px-2" onClick={() => navigate(-1)}>
        <Icon name="back" size={18} /> Back
      </button>

      {loading ? (
        <div className="card space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      ) : error ? (
        <EmptyState
          icon="lock"
          title="This post isn't available"
          description={error}
          action={
            <Link to="/" className="btn btn-primary">
              Back to feed
            </Link>
          }
        />
      ) : post ? (
        <PostCard
          post={post}
          defaultCommentsOpen
          onChange={setPost}
          onDeleted={() => {
            toast('Post deleted', 'success');
            navigate('/');
          }}
        />
      ) : null}
    </div>
  );
}
