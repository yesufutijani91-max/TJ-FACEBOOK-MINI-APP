import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Group, PostView, User } from '../../shared/types';
import { Composer } from '../components/Composer';
import { Icon } from '../components/icons';
import { PostCard } from '../components/PostCard';
import { Avatar, ConfirmDialog, EmptyState, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatCount } from '../lib/format';
import { useSession } from '../state/session';

export default function GroupDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user, toast } = useSession();
  const [group, setGroup] = useState<Group | null>(null);
  const [posts, setPosts] = useState<PostView[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'discussion' | 'members'>('discussion');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ group: found }, membersList, page] = await Promise.all([api.group(id), api.groupMembers(id), api.groupPosts(id)]);
      setGroup(found);
      setMembers(membersList.items);
      setPosts(page.items);
      setCursor(page.nextCursor);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load group', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAdmin = group?.role === 'owner' || group?.role === 'admin';

  const toggleMembership = async () => {
    if (!group) return;
    setBusy(true);
    try {
      if (group.isMember) await api.leaveGroup(group.id);
      else await api.joinGroup(group.id);
      await load();
      toast(group.isMember ? 'You left the group' : 'You joined the group', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const setRole = async (userId: string, role: 'admin' | 'member') => {
    try {
      await api.setGroupRole(id, userId, role);
      await load();
      toast(role === 'admin' ? 'Member promoted to admin' : 'Admin rights removed', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not change role', 'error');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-3">
        <div className="card overflow-hidden">
          <Skeleton className="h-32 w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="mx-auto w-full max-w-2xl px-3 py-6">
        <EmptyState icon="group" title="Group not found" description="It may have been removed." action={<Link to="/groups" className="btn btn-primary">Browse groups</Link>} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-3 sm:px-4">
      <section className="card overflow-hidden">
        <div className="relative h-32 bg-gradient-to-r from-brand-600 to-brand-800 sm:h-44">
          {group.coverUrl && <img src={group.coverUrl} alt="" className="h-full w-full object-cover" />}
          <button className="absolute left-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur" onClick={() => navigate(-1)} aria-label="Back">
            <Icon name="back" size={18} />
          </button>
        </div>
        <div className="space-y-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-extrabold text-strong">{group.name}</h1>
              <p className="text-xs text-soft">
                {group.privacy === 'public' ? 'Public group' : 'Private group'} · {formatCount(group.memberCount)} members
              </p>
            </div>
            <div className="flex gap-2">
              {group.isMember ? (
                <button className="btn btn-ghost" disabled={busy} onClick={() => void toggleMembership()}>
                  {busy ? <Spinner size={14} /> : 'Leave group'}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={busy} onClick={() => void toggleMembership()}>
                  {busy ? <Spinner size={14} /> : 'Join group'}
                </button>
              )}
              {isAdmin && (
                <button className="icon-btn text-rose-500" onClick={() => setConfirmDelete(true)} aria-label="Delete group">
                  <Icon name="trash" size={18} />
                </button>
              )}
            </div>
          </div>
          {group.description && <p className="whitespace-pre-wrap text-sm text-strong">{group.description}</p>}
        </div>
      </section>

      <div className="card flex gap-1 p-1.5">
        {(['discussion', 'members'] as const).map((option) => (
          <button
            key={option}
            onClick={() => setTab(option)}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold capitalize transition ${
              tab === option ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-soft hover:text-strong'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      {tab === 'discussion' ? (
        group.isMember ? (
          <div className="space-y-3">
            <Composer
              group={group}
              placeholder={`Share something with ${group.name}…`}
              onCreated={(post) => {
                setPosts((current) => [post, ...current]);
                setGroup((current) => (current ? { ...current, postCount: current.postCount + 1 } : current));
              }}
            />
            {posts.length === 0 ? (
              <EmptyState icon="chat" title="No discussion yet" description="Be the first to post in this group." />
            ) : (
              posts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onChange={(next) => setPosts((current) => current.map((item) => (item.id === next.id ? next : item)))}
                  onDeleted={(deleted) => setPosts((current) => current.filter((item) => item.id !== deleted))}
                />
              ))
            )}
            {cursor && (
              <div className="flex justify-center pb-2">
                <button
                  className="btn btn-soft"
                  onClick={async () => {
                    const page = await api.groupPosts(id, cursor);
                    setPosts((current) => [...current, ...page.items]);
                    setCursor(page.nextCursor);
                  }}
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon="lock"
            title="Join to see the discussion"
            description="Members of this group can read and create posts."
            action={
              <button className="btn btn-primary" onClick={() => void toggleMembership()}>
                Join group
              </button>
            }
          />
        )
      ) : (
        <div className="card divide-y divide-[var(--border-subtle)]">
          {members.map((member) => {
            const role = group.role && member.id === user?.id ? group.role : undefined;
            return (
              <div key={member.id} className="flex items-center gap-2.5 p-3">
                <Link to={`/u/${member.id}`}>
                  <Avatar user={member} size={40} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/u/${member.id}`} className="block truncate text-sm font-semibold text-strong hover:underline">
                    {member.name}
                  </Link>
                  <p className="truncate text-xs text-soft">
                    @{member.handle}
                    {role === 'owner' ? ' · Owner' : ''}
                  </p>
                </div>
                {isAdmin && member.id !== user?.id && (
                  <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => void setRole(member.id, 'admin')}>
                    <Icon name="shield" size={14} /> Make admin
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this group?"
        description="All posts and membership data for this group will be permanently removed."
        confirmLabel="Delete group"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            await api.deleteGroup(id);
            toast('Group deleted', 'success');
            navigate('/groups');
          } catch (error) {
            toast(error instanceof Error ? error.message : 'Could not delete group', 'error');
          }
        }}
      />
    </div>
  );
}
