import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Group } from '../../shared/types';
import { Icon } from '../components/icons';
import { Avatar, EmptyState, Field, Modal, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatCount } from '../lib/format';
import { useSession } from '../state/session';

function CreateGroupModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (group: Group) => void }) {
  const { toast } = useSession();
  const [form, setForm] = useState({ name: '', description: '', privacy: 'public' as Group['privacy'] });
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await api.upload(file);
      setCoverUrl(uploaded.url);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Cover upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const create = async () => {
    if (form.name.trim().length < 3) {
      toast('Group name must be at least 3 characters', 'error');
      return;
    }
    setBusy(true);
    try {
      const { group } = await api.createGroup({
        name: form.name.trim(),
        description: form.description.trim(),
        privacy: form.privacy,
        coverUrl: coverUrl ?? undefined,
      });
      onCreated(group);
      onClose();
      setForm({ name: '', description: '', privacy: 'public' });
      setCoverUrl(null);
      toast('Group created', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create group', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create a group">
      <div className="space-y-3">
        <button
          className="flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-subtle text-soft transition hover:border-brand-400"
          onClick={() => fileRef.current?.click()}
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : uploading ? (
            <Spinner />
          ) : (
            <span className="inline-flex items-center gap-2 text-sm">
              <Icon name="image" size={16} /> Add cover photo
            </span>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => void pickCover(event.target.files?.[0])} />
        <Field label="Group name">
          <input className="input" value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Photography lovers" />
        </Field>
        <Field label="Description">
          <textarea className="input min-h-[80px]" value={form.description} maxLength={500} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What is this group about?" />
        </Field>
        <Field label="Privacy">
          <select className="input" value={form.privacy} onChange={(event) => setForm({ ...form, privacy: event.target.value as Group['privacy'] })}>
            <option value="public">Public — anyone can join</option>
            <option value="private">Private — request to join</option>
          </select>
        </Field>
        <button className="btn btn-primary w-full" onClick={() => void create()} disabled={busy || uploading}>
          {busy ? <Spinner size={16} /> : 'Create group'}
        </button>
      </div>
    </Modal>
  );
}

export default function GroupsPage() {
  const { toast } = useSession();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (search: string) => {
      try {
        const { items } = await api.groups(search.trim() || undefined);
        setGroups(items);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load groups', 'error');
        setGroups([]);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 320);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const join = async (group: Group) => {
    try {
      if (group.isMember) await api.leaveGroup(group.id);
      else await api.joinGroup(group.id);
      await load(query);
      toast(group.isMember ? `Left ${group.name}` : `Joined ${group.name}`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Action failed', 'error');
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3 px-3 py-3 sm:px-4">
      <div className="card space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-extrabold text-strong">Groups</h1>
            <p className="text-xs text-soft">Communities built around what you care about.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> Create
          </button>
        </div>
        <div className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soft" />
          <input className="input pl-8" placeholder="Search groups" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      {groups === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="card space-y-2 p-3">
              <Skeleton className="h-24 w-full rounded-xl" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="group"
          title="No groups found"
          description="Start the first community on TJ SOCIAL."
          action={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              Create a group
            </button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <article key={group.id} className="card overflow-hidden">
              <Link to={`/groups/${group.id}`} className="block">
                <div className="h-28 w-full bg-gradient-to-br from-brand-500 to-brand-800">
                  {group.coverUrl && <img src={group.coverUrl} alt="" className="h-full w-full object-cover" />}
                </div>
              </Link>
              <div className="space-y-2 p-3">
                <Link to={`/groups/${group.id}`} className="block truncate font-bold text-strong hover:underline">
                  {group.name}
                </Link>
                <p className="clamp-2 text-xs text-soft">{group.description || 'No description yet.'}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[0.7rem] text-soft">
                    {formatCount(group.memberCount)} members · {group.privacy}
                  </span>
                  <button className={`btn ${group.isMember ? 'btn-ghost' : 'btn-primary'} px-3 py-1.5 text-xs`} onClick={() => void join(group)}>
                    {group.isMember ? 'Leave' : 'Join'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <CreateGroupModal open={creating} onClose={() => setCreating(false)} onCreated={() => void load(query)} />
    </div>
  );
}
