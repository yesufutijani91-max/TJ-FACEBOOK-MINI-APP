import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PostView, ProfileView, User } from '../../shared/types';
import { Icon } from '../components/icons';
import { PostCard } from '../components/PostCard';
import { Avatar, ConfirmDialog, EmptyState, Field, Modal, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatCount } from '../lib/format';
import { useSession } from '../state/session';

function EditProfileModal({
  open,
  onClose,
  profile,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  profile: ProfileView;
  onSaved: (user: User) => void;
}) {
  const { toast } = useSession();
  const [form, setForm] = useState({
    name: profile.user.name,
    handle: profile.user.handle,
    bio: profile.user.bio ?? '',
    location: profile.user.location ?? '',
    website: profile.user.website ?? '',
    privacy: profile.user.privacy,
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null);
  const avatarRef = useRef<HTMLInputElement | null>(null);
  const coverRef = useRef<HTMLInputElement | null>(null);

  const upload = async (kind: 'avatar' | 'cover', file: File | undefined) => {
    if (!file) return;
    setUploading(kind);
    try {
      const uploaded = await api.upload(file);
      const patch = kind === 'avatar' ? { avatarUrl: uploaded.url } : { coverUrl: uploaded.url };
      const { user } = await api.updateMe(patch);
      onSaved(user);
      toast(kind === 'avatar' ? 'Profile photo updated' : 'Cover updated', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Upload failed', 'error');
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const { user } = await api.updateMe({
        name: form.name.trim(),
        handle: form.handle.trim().replace(/^@/, ''),
        bio: form.bio.trim(),
        location: form.location.trim(),
        website: form.website.trim(),
        privacy: form.privacy,
      });
      onSaved(user);
      onClose();
      toast('Profile updated', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save profile', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit profile">
      <div className="space-y-3">
        <div className="flex gap-3">
          <button className="relative" onClick={() => avatarRef.current?.click()}>
            <Avatar user={profile.user} size={64} />
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40 text-white opacity-0 transition hover:opacity-100">
              {uploading === 'avatar' ? <Spinner size={16} /> : <Icon name="camera" size={18} />}
            </span>
          </button>
          <button className="btn btn-soft self-center" onClick={() => coverRef.current?.click()}>
            {uploading === 'cover' ? <Spinner size={14} /> : <Icon name="image" size={16} />} Change cover
          </button>
        </div>
        <input ref={avatarRef} type="file" accept="image/*" hidden onChange={(event) => void upload('avatar', event.target.files?.[0])} />
        <input ref={coverRef} type="file" accept="image/*" hidden onChange={(event) => void upload('cover', event.target.files?.[0])} />

        <Field label="Name">
          <input className="input" value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Username">
          <input className="input" value={form.handle} onChange={(event) => setForm({ ...form, handle: event.target.value })} />
        </Field>
        <Field label="Bio">
          <textarea className="input min-h-[80px]" value={form.bio} maxLength={240} onChange={(event) => setForm({ ...form, bio: event.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Location">
            <input className="input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
          </Field>
          <Field label="Website">
            <input className="input" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} />
          </Field>
        </div>
        <Field label="Profile privacy">
          <select className="input" value={form.privacy} onChange={(event) => setForm({ ...form, privacy: event.target.value as User['privacy'] })}>
            <option value="public">Public — anyone can see your posts</option>
            <option value="friends">Friends only</option>
            <option value="private">Private — only you</option>
          </select>
        </Field>
        <button className="btn btn-primary w-full" onClick={() => void save()} disabled={busy || Boolean(uploading)}>
          {busy ? <Spinner size={16} /> : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}

export default function ProfilePage() {
  const { id } = useParams();
  const { user: me, toast, refreshSession } = useSession();
  const targetId = id ?? me?.id ?? '';
  const isMe = Boolean(me && targetId === me.id);

  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [posts, setPosts] = useState<PostView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [tab, setTab] = useState<'posts' | 'about' | 'friends'>('posts');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      const view = await api.profile(targetId);
      setProfile(view);
      if (view.canViewContent) {
        setLoadingPosts(true);
        const page = await api.userPosts(targetId);
        setPosts(page.items);
        setCursor(page.nextCursor);
      } else {
        setPosts([]);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load profile', 'error');
    } finally {
      setLoading(false);
      setLoadingPosts(false);
    }
  }, [targetId, toast]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const loadMore = async () => {
    if (!cursor) return;
    try {
      const page = await api.userPosts(targetId, cursor);
      setPosts((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load more posts', 'error');
    }
  };

  const act = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await run();
      toast(message, 'success');
      await loadProfile();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-3 sm:px-4">
        <div className="card overflow-hidden">
          <Skeleton className="h-36 w-full rounded-none" />
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-2xl px-3 py-6">
        <EmptyState icon="user" title="Profile unavailable" description="This account may have been suspended or removed." />
      </div>
    );
  }

  const { user: person } = profile;
  const state = profile.friendState.status;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-3 sm:px-4">
      <section className="card overflow-hidden">
        <div className="relative h-36 w-full bg-gradient-to-r from-brand-500 to-brand-700 sm:h-48">
          {person.coverUrl && <img src={person.coverUrl} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="px-4 pb-4">
          <div className="-mt-10 flex items-end gap-3">
            <div className="rounded-full ring-4 ring-white dark:ring-[#0d1117]">
              <Avatar user={person} size={84} />
            </div>
            <div className="mb-1 flex flex-1 flex-wrap justify-end gap-2">
              {isMe ? (
                <>
                  <button className="btn btn-soft" onClick={() => setEditing(true)}>
                    <Icon name="edit" size={16} /> Edit profile
                  </button>
                  <Link to="/settings" className="btn btn-ghost">
                    <Icon name="settings" size={16} />
                  </Link>
                </>
              ) : (
                <>
                  <Link to={`/messages?to=${person.id}`} className="btn btn-soft">
                    <Icon name="chat" size={16} /> Message
                  </Link>
                  {state === 'friends' ? (
                    <button
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => void act(() => api.removeFriendship(person.id), 'Friend removed')}
                    >
                      Friends
                    </button>
                  ) : state === 'pending_out' ? (
                    <button className="btn btn-ghost" disabled={busy} onClick={() => void act(() => api.respondFriendRequest(person.id, false), 'Request cancelled')}>
                      Requested
                    </button>
                  ) : state === 'pending_in' ? (
                    <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.respondFriendRequest(person.id, true), 'Friend request accepted')}>
                      Accept request
                    </button>
                  ) : (
                    <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => api.sendFriendRequest(person.id), 'Friend request sent')}>
                      Add friend
                    </button>
                  )}
                  <button
                    className={`btn ${profile.isFollowing ? 'btn-ghost' : 'btn-soft'}`}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () => (profile.isFollowing ? api.unfollow(person.id) : api.follow(person.id)),
                        profile.isFollowing ? 'Unfollowed' : 'Following',
                      )
                    }
                  >
                    {profile.isFollowing ? 'Following' : 'Follow'}
                  </button>
                  <button className="icon-btn" onClick={() => setConfirmBlock(true)} aria-label="More actions">
                    <Icon name="more" size={18} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="mt-2">
            <h1 className="flex items-center gap-1.5 text-xl font-extrabold text-strong">
              {person.name}
              {person.isAdmin && <Icon name="shield" size={16} className="text-brand-600" />}
            </h1>
            <p className="text-sm text-soft">@{person.handle}</p>
            {person.bio && <p className="mt-2 whitespace-pre-wrap text-sm text-strong">{person.bio}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-soft">
              {person.location && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="pin" size={13} /> {person.location}
                </span>
              )}
              {person.website && (
                <a href={person.website.startsWith('http') ? person.website : `https://${person.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                  <Icon name="globe" size={13} /> {person.website.replace(/^https?:\/\//, '')}
                </a>
              )}
              <span className="inline-flex items-center gap-1">
                <Icon name={person.privacy === 'public' ? 'globe' : 'lock'} size={13} />
                {person.privacy === 'public' ? 'Public profile' : person.privacy === 'friends' ? 'Friends only' : 'Private'}
              </span>
            </div>
            <div className="mt-3 flex gap-4 text-sm">
              <span className="text-soft">
                <strong className="text-strong">{formatCount(profile.postCount)}</strong> posts
              </span>
              <span className="text-soft">
                <strong className="text-strong">{formatCount(profile.friendCount)}</strong> friends
              </span>
              <span className="text-soft">
                <strong className="text-strong">{formatCount(profile.followerCount)}</strong> followers
              </span>
              <span className="text-soft">
                <strong className="text-strong">{formatCount(profile.followingCount)}</strong> following
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="card flex gap-1 p-1.5">
        {(['posts', 'about', 'friends'] as const).map((option) => (
          <button
            key={option}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold capitalize transition ${
              tab === option ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-soft hover:text-strong'
            }`}
            onClick={() => setTab(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {tab === 'posts' ? (
        !profile.canViewContent ? (
          <EmptyState icon="lock" title="This profile is private" description="Add them as a friend to see their posts and photos." />
        ) : loadingPosts ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="card space-y-3 p-4">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-40 w-full rounded-2xl" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon="edit"
            title={isMe ? 'Share your first post' : 'No posts yet'}
            description={isMe ? 'Your posts will appear here and in your friends’ feeds.' : 'When they post, you will see it here.'}
            action={
              isMe ? (
                <Link to="/" className="btn btn-primary">
                  Create a post
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onChange={(next) => setPosts((current) => current.map((item) => (item.id === next.id ? next : item)))}
                onDeleted={(deleted) => setPosts((current) => current.filter((item) => item.id !== deleted))}
              />
            ))}
            {cursor && (
              <div className="flex justify-center py-2">
                <button className="btn btn-soft" onClick={() => void loadMore()}>
                  Load more
                </button>
              </div>
            )}
          </div>
        )
      ) : tab === 'about' ? (
        <div className="card space-y-3 p-4 text-sm">
          <h2 className="font-bold text-strong">About {person.name.split(' ')[0]}</h2>
          <dl className="grid gap-2">
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-soft">Bio</dt>
              <dd className="text-strong">{person.bio || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-soft">Location</dt>
              <dd className="text-strong">{person.location || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-soft">Website</dt>
              <dd className="truncate text-strong">{person.website || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-soft">Username</dt>
              <dd className="text-strong">@{person.handle}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-soft">Joined</dt>
              <dd className="text-strong">{new Date(person.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-soft">Telegram</dt>
              <dd className="text-strong">{person.telegramId ? 'Linked' : 'Not linked'}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <FriendsTab userId={targetId} />
      )}

      {editing && <EditProfileModal open={editing} onClose={() => setEditing(false)} profile={profile} onSaved={() => void refreshSession().then(loadProfile)} />}

      <ConfirmDialog
        open={confirmBlock}
        title={`Block ${person.name}?`}
        description="They won't be able to find your profile, message you or interact with your posts. You can unblock them in Friends → Blocked."
        confirmLabel="Block"
        destructive
        onCancel={() => setConfirmBlock(false)}
        onConfirm={async () => {
          await act(() => api.block(person.id), `${person.name} blocked`);
          setConfirmBlock(false);
        }}
      />
    </div>
  );
}

function FriendsTab({ userId }: { userId: string }) {
  const { user: me } = useSession();
  const [people, setPeople] = useState<User[] | null>(null);

  useEffect(() => {
    if (userId !== me?.id) {
      setPeople([]);
      return;
    }
    api
      .friends()
      .then(({ items }) => setPeople(items))
      .catch(() => setPeople([]));
  }, [userId, me?.id]);

  if (people === null) {
    return (
      <div className="card p-4">
        <Skeleton className="h-3 w-32" />
      </div>
    );
  }

  if (userId !== me?.id) {
    return <EmptyState icon="users" title="Friends are private" description="Only the profile owner can see their full friend list." />;
  }

  return people.length === 0 ? (
    <EmptyState icon="users" title="No friends yet" description="Find people you know and send a friend request." action={<Link to="/friends" className="btn btn-primary">Find friends</Link>} />
  ) : (
    <div className="card grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
      {people.map((person) => (
        <Link key={person.id} to={`/u/${person.id}`} className="rounded-xl border border-subtle p-2 text-center transition hover:shadow-md">
          <Avatar user={person} size={56} className="mx-auto" />
          <p className="mt-1.5 truncate text-sm font-semibold text-strong">{person.name}</p>
          <p className="truncate text-xs text-soft">@{person.handle}</p>
        </Link>
      ))}
    </div>
  );
}
