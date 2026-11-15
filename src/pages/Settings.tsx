import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '../../shared/types';
import { Icon, Logo } from '../components/icons';
import { Avatar, ConfirmDialog, EmptyState, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../state/session';

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-strong">{title}</p>
        {description && <p className="mt-0.5 text-xs text-soft">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, features, mode, theme, toggleTheme, logout, toast, setUser, settings } = useSession();
  const [blocked, setBlocked] = useState<User[] | null>(null);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .blocked()
      .then(({ items }) => setBlocked(items))
      .catch(() => setBlocked([]));
  }, []);

  if (!user) return null;

  const changePrivacy = async (privacy: User['privacy']) => {
    setSavingPrivacy(true);
    try {
      const { user: updated } = await api.updateMe({ privacy });
      setUser(updated);
      toast('Profile privacy updated', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not update privacy', 'error');
    } finally {
      setSavingPrivacy(false);
    }
  };

  const unblock = async (person: User) => {
    setBusy(true);
    try {
      await api.unblock(person.id);
      setBlocked((current) => (current ?? []).filter((item) => item.id !== person.id));
      toast(`${person.name} unblocked`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not unblock', 'error');
    } finally {
      setBusy(false);
    }
  };

  const telegramLink = features.botUsername ? `https://t.me/${features.botUsername}` : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-3 py-3 sm:px-4">
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <Avatar user={user} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold text-strong">{user.name}</p>
            <p className="truncate text-xs text-soft">@{user.handle}</p>
          </div>
          <Link to={`/u/${user.id}`} className="btn btn-soft">
            View profile
          </Link>
        </div>
      </div>

      <section className="card overflow-hidden">
        <h2 className="border-b border-subtle px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-soft">Account</h2>
        <div className="divide-y divide-[var(--border-subtle)]">
          <Row title="Telegram account" description={user.telegramId ? 'Linked to your Telegram identity' : 'Not linked — sign in through the bot to link'}>
            <span className={`chip ${user.telegramId ? 'chip-active' : ''}`}>{user.telegramId ? 'Linked' : 'Guest'}</span>
          </Row>
          <Row title="Profile privacy" description="Controls who can see your posts and photos">
            <select
              className="input w-auto py-1.5 text-sm"
              value={user.privacy}
              disabled={savingPrivacy}
              onChange={(event) => void changePrivacy(event.target.value as User['privacy'])}
            >
              <option value="public">Public</option>
              <option value="friends">Friends</option>
              <option value="private">Private</option>
            </select>
          </Row>
          <Row title="Appearance" description={`Currently using ${theme} mode`}>
            <button className="btn btn-soft" onClick={toggleTheme}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /> {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </Row>
          <Row title="Edit profile" description="Name, bio, photos and links">
            <Link to={`/u/${user.id}`} className="btn btn-ghost">
              <Icon name="edit" size={16} />
            </Link>
          </Row>
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-subtle px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-soft">Notifications</h2>
        <div className="divide-y divide-[var(--border-subtle)]">
          <Row title="In-app notifications" description="Likes, comments, friend requests, messages and group activity">
            <span className="chip chip-active">On</span>
          </Row>
          <Row
            title="Telegram bot notifications"
            description={
              telegramLink
                ? 'Open the bot and press Start so it can message you about activity'
                : 'Set TELEGRAM_BOT_USERNAME and TELEGRAM_BOT_TOKEN on the server to enable bot notifications'
            }
          >
            {telegramLink ? (
              <a href={telegramLink} target="_blank" rel="noreferrer" className="btn btn-primary">
                Open bot
              </a>
            ) : (
              <span className="chip">Not configured</span>
            )}
          </Row>
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-subtle px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-soft">Blocked accounts</h2>
        {blocked === null ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-3 w-32" />
          </div>
        ) : blocked.length === 0 ? (
          <p className="px-4 py-4 text-sm text-soft">You haven't blocked anyone.</p>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {blocked.map((person) => (
              <div key={person.id} className="flex items-center gap-2.5 px-4 py-3">
                <Avatar user={person} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-strong">{person.name}</p>
                  <p className="truncate text-xs text-soft">@{person.handle}</p>
                </div>
                <button className="btn btn-soft px-3 py-1.5 text-xs" disabled={busy} onClick={() => void unblock(person)}>
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-subtle px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-soft">Platform</h2>
        <div className="divide-y divide-[var(--border-subtle)]">
          <Row title="Data mode" description={mode === 'supabase' ? 'Connected to Supabase (Postgres + Storage)' : 'Local development store (data resets with the server)'}>
            <span className={`chip ${mode === 'supabase' ? 'chip-active' : ''}`}>{mode}</span>
          </Row>
          <Row title="Media storage" description={features.storage ? 'Uploads are stored in Supabase Storage' : 'Uploads are stored on the application server'}>
            <span className="chip">{features.storage ? 'Supabase' : 'Local'}</span>
          </Row>
          {user.isAdmin && (
            <Row title="Administrator dashboard" description="Users, reports, groups and platform settings">
              <Link to="/admin" className="btn btn-soft">
                <Icon name="shield" size={16} /> Open
              </Link>
            </Row>
          )}
          <Row title="Sign out" description="You will need to sign in through Telegram again">
            <button className="btn btn-danger" onClick={() => setConfirmLogout(true)}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </Row>
        </div>
      </section>

      <div className="flex flex-col items-center gap-1 py-4 text-center">
        <Logo size={28} />
        <p className="text-sm font-bold text-strong">{settings?.siteName ?? 'TJ SOCIAL'}</p>
        <p className="text-xs text-soft">{settings?.tagline ?? 'Connect. Share. Discover.'}</p>
        <p className="mt-1 text-[0.68rem] text-soft">Version 1.0.0 · Built for Telegram Mini Apps</p>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="Sign out of TJ SOCIAL?"
        description="Your session on this device will end."
        confirmLabel="Sign out"
        destructive
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => {
          await logout();
          setConfirmLogout(false);
        }}
      />
    </div>
  );
}

export function SettingsFallback() {
  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-6">
      <EmptyState icon="settings" title="Settings" description="Sign in to manage your account." action={<Link to="/" className="btn btn-primary">Go home</Link>} />
    </div>
  );
}

export { Spinner };
