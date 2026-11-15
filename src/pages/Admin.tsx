import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminStats, AppSettings, Group, Report, User } from '../../shared/types';
import { Icon, type IconName } from '../components/icons';
import { Avatar, EmptyState, Field, Segmented, Skeleton, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useSession } from '../state/session';

type Tab = 'overview' | 'users' | 'reports' | 'groups' | 'settings';

function StatCard({ icon, label, value, hint }: { icon: IconName; label: string; value: number | string; hint?: string }) {
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-2 text-soft">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
          <Icon name={icon} size={16} />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-extrabold text-strong">{value}</p>
      {hint && <p className="text-xs text-soft">{hint}</p>}
    </div>
  );
}

export default function AdminPage() {
  const { user, toast } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<{ items: User[]; total: number } | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [reportFilter, setReportFilter] = useState<'open' | 'resolved' | 'dismissed'>('open');
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.adminStats());
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load statistics', 'error');
    }
  }, [toast]);

  const loadUsers = useCallback(
    async (query: string) => {
      try {
        setUsers(await api.adminUsers({ q: query.trim() || undefined, limit: 50 }));
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load users', 'error');
      }
    },
    [toast],
  );

  const loadReports = useCallback(
    async (status: 'open' | 'resolved' | 'dismissed') => {
      try {
        const { items } = await api.adminReports(status);
        setReports(items);
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not load reports', 'error');
      }
    },
    [toast],
  );

  const loadGroups = useCallback(async () => {
    try {
      const { items } = await api.adminGroups();
      setGroups(items);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load groups', 'error');
    }
  }, [toast]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (tab === 'users') void loadUsers(userQuery);
    if (tab === 'reports') void loadReports(reportFilter);
    if (tab === 'groups') void loadGroups();
    if (tab === 'settings' && !settings) {
      api
        .adminSettings()
        .then(({ settings: found }) => setSettings(found))
        .catch((error) => toast(error instanceof Error ? error.message : 'Could not load settings', 'error'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== 'users') return;
    const timer = window.setTimeout(() => void loadUsers(userQuery), 320);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userQuery]);

  if (!user?.isAdmin) {
    return (
      <div className="mx-auto w-full max-w-2xl px-3 py-6">
        <EmptyState icon="lock" title="Administrators only" description="This area is restricted to platform administrators." action={<Link to="/" className="btn btn-primary">Back home</Link>} />
      </div>
    );
  }

  const suspend = async (person: User) => {
    setBusyId(person.id);
    try {
      await api.adminSuspend(person.id, !person.suspended);
      await loadUsers(userQuery);
      toast(person.suspended ? `${person.name} reinstated` : `${person.name} suspended`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not update user', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const resolveReport = async (report: Report, action: 'resolve' | 'dismiss') => {
    setBusyId(report.id);
    try {
      await api.adminResolveReport(report.id, action);
      await loadReports(reportFilter);
      await loadStats();
      toast(action === 'resolve' ? 'Report resolved' : 'Report dismissed', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not update report', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deletePostFromReport = async (report: Report) => {
    setBusyId(report.id);
    try {
      if (report.targetType === 'post') await api.adminDeletePost(report.targetId);
      await api.adminResolveReport(report.id, 'resolve');
      await Promise.all([loadReports(reportFilter), loadStats()]);
      toast('Content removed and report resolved', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not remove content', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deleteGroup = async (group: Group) => {
    setBusyId(group.id);
    try {
      await api.adminDeleteGroup(group.id);
      await Promise.all([loadGroups(), loadStats()]);
      toast(`${group.name} deleted`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not delete group', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const { settings: saved } = await api.adminUpdateSettings(settings);
      setSettings(saved);
      toast('Platform settings saved', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 px-3 py-3 sm:px-4">
      <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-strong">
            <Icon name="shield" size={18} className="text-brand-600" /> Administrator
          </h1>
          <p className="text-xs text-soft">Platform moderation and configuration</p>
        </div>
        <span className="chip chip-active">{stats?.mode ?? '—'} mode</span>
      </div>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'users', label: 'Users' },
          { value: 'reports', label: `Reports${stats ? ` · ${stats.openReports}` : ''}` },
          { value: 'groups', label: 'Groups' },
          { value: 'settings', label: 'Settings' },
        ]}
      />

      {tab === 'overview' &&
        (stats ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard icon="users" label="Users" value={stats.users} hint={`+${stats.newUsers7d} this week`} />
              <StatCard icon="edit" label="Posts" value={stats.posts} hint={`+${stats.posts7d} this week`} />
              <StatCard icon="comment" label="Comments" value={stats.comments} />
              <StatCard icon="eye" label="Stories" value={stats.stories} />
              <StatCard icon="chat" label="Messages" value={stats.messages} />
              <StatCard icon="group" label="Groups" value={stats.groups} />
              <StatCard icon="shop" label="Listings" value={stats.listings} />
              <StatCard icon="bell" label="Open reports" value={stats.openReports} />
            </div>
            <div className="card flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-semibold text-strong">Moderation queue</p>
                <p className="text-xs text-soft">{stats.openReports} report(s) waiting for review.</p>
              </div>
              <button className="btn btn-primary" onClick={() => setTab('reports')}>
                Review reports
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-24 rounded-2xl" />
            ))}
          </div>
        ))}

      {tab === 'users' && (
        <div className="space-y-3">
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-soft" />
            <input className="input pl-8" placeholder="Search users by name, handle or Telegram ID" value={userQuery} onChange={(event) => setUserQuery(event.target.value)} />
          </div>
          {users === null ? (
            <Skeleton className="h-40 rounded-2xl" />
          ) : users.items.length === 0 ? (
            <EmptyState icon="users" title="No users found" description="Try a different search." />
          ) : (
            <div className="card divide-y divide-[var(--border-subtle)]">
              <p className="px-4 py-2 text-xs text-soft">{users.total} registered account(s)</p>
              {users.items.map((person) => (
                <div key={person.id} className="flex flex-wrap items-center gap-2.5 p-3">
                  <Avatar user={person} size={38} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/u/${person.id}`} className="block truncate text-sm font-semibold text-strong hover:underline">
                      {person.name} {person.isAdmin && <span className="text-xs text-brand-600">· admin</span>}
                    </Link>
                    <p className="truncate text-xs text-soft">
                      @{person.handle} · joined {timeAgo(person.createdAt)}
                      {person.telegramId ? ` · tg ${person.telegramId}` : ''}
                    </p>
                  </div>
                  {person.suspended && <span className="chip text-rose-600">suspended</span>}
                  <button
                    className={`btn px-3 py-1.5 text-xs ${person.suspended ? 'btn-soft' : 'btn-danger'}`}
                    disabled={busyId === person.id || person.id === user.id}
                    onClick={() => void suspend(person)}
                  >
                    {busyId === person.id ? <Spinner size={12} /> : person.suspended ? 'Reinstate' : 'Suspend'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'reports' && (
        <div className="space-y-3">
          <Segmented
            value={reportFilter}
            onChange={setReportFilter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'dismissed', label: 'Dismissed' },
            ]}
          />
          {reports === null ? (
            <Skeleton className="h-40 rounded-2xl" />
          ) : reports.length === 0 ? (
            <EmptyState icon="check" title="Nothing to review" description={`No ${reportFilter} reports right now.`} />
          ) : (
            <div className="card divide-y divide-[var(--border-subtle)]">
              {reports.map((report) => (
                <div key={report.id} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
                    <span className="chip">{report.targetType}</span>
                    <span>{report.reason}</span>
                    <span>· {timeAgo(report.createdAt)}</span>
                    {report.reporter && (
                      <span className="ml-auto inline-flex items-center gap-1">
                        <Avatar user={report.reporter} size={18} /> {report.reporter.name}
                      </span>
                    )}
                  </div>
                  {report.details && <p className="text-sm text-strong">{report.details}</p>}
                  <div className="flex flex-wrap gap-2">
                    {report.targetType === 'post' && (
                      <Link to={`/post/${report.targetId}`} className="btn btn-ghost px-3 py-1.5 text-xs">
                        View post
                      </Link>
                    )}
                    {report.targetType === 'user' && (
                      <Link to={`/u/${report.targetId}`} className="btn btn-ghost px-3 py-1.5 text-xs">
                        View profile
                      </Link>
                    )}
                    {report.status === 'open' && (
                      <>
                        {report.targetType === 'post' && (
                          <button className="btn btn-danger px-3 py-1.5 text-xs" disabled={busyId === report.id} onClick={() => void deletePostFromReport(report)}>
                            {busyId === report.id ? <Spinner size={12} /> : 'Delete post & resolve'}
                          </button>
                        )}
                        <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busyId === report.id} onClick={() => void resolveReport(report, 'resolve')}>
                          Resolve
                        </button>
                        <button className="btn btn-soft px-3 py-1.5 text-xs" disabled={busyId === report.id} onClick={() => void resolveReport(report, 'dismiss')}>
                          Dismiss
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'groups' && (
        groups === null ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : groups.length === 0 ? (
          <EmptyState icon="group" title="No groups yet" description="Groups created by members will appear here." />
        ) : (
          <div className="card divide-y divide-[var(--border-subtle)]">
            {groups.map((group) => (
              <div key={group.id} className="flex items-center gap-2.5 p-3">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-brand-100">
                  {group.coverUrl && <img src={group.coverUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/groups/${group.id}`} className="block truncate text-sm font-semibold text-strong hover:underline">
                    {group.name}
                  </Link>
                  <p className="text-xs text-soft">
                    {group.memberCount} members · {group.privacy}
                  </p>
                </div>
                <button className="btn btn-danger px-3 py-1.5 text-xs" disabled={busyId === group.id} onClick={() => void deleteGroup(group)}>
                  {busyId === group.id ? <Spinner size={12} /> : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'settings' &&
        (settings ? (
          <div className="card space-y-3 p-4">
            <Field label="Site name">
              <input className="input" value={settings.siteName} onChange={(event) => setSettings({ ...settings, siteName: event.target.value })} />
            </Field>
            <Field label="Tagline">
              <input className="input" value={settings.tagline} onChange={(event) => setSettings({ ...settings, tagline: event.target.value })} />
            </Field>
            <Field label="Maintenance message" hint="Shown as a banner to all users when set">
              <textarea className="input min-h-[80px]" value={settings.maintenanceMessage} onChange={(event) => setSettings({ ...settings, maintenanceMessage: event.target.value })} />
            </Field>
            <Field label="Max upload size (MB)">
              <input
                type="number"
                className="input"
                min={1}
                max={100}
                value={settings.maxUploadMb}
                onChange={(event) => setSettings({ ...settings, maxUploadMb: Number(event.target.value) })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-strong">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-subtle"
                checked={settings.registrationOpen}
                onChange={(event) => setSettings({ ...settings, registrationOpen: event.target.checked })}
              />
              Allow new Telegram accounts to register
            </label>
            <button className="btn btn-primary" onClick={() => void saveSettings()} disabled={savingSettings}>
              {savingSettings ? <Spinner size={16} /> : 'Save settings'}
            </button>
          </div>
        ) : (
          <Skeleton className="h-48 rounded-2xl" />
        ))}
    </div>
  );
}
