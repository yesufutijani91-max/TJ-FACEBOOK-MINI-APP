import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppNotification, NotificationType } from '../../shared/types';
import { Icon, type IconName } from '../components/icons';
import { Avatar, EmptyState, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useSession } from '../state/session';

const META: Record<NotificationType, { icon: IconName; tint: string }> = {
  like: { icon: 'heart', tint: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
  comment: { icon: 'comment', tint: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  reply: { icon: 'reply', tint: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  friend_request: { icon: 'users', tint: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' },
  friend_accept: { icon: 'check', tint: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300' },
  follow: { icon: 'user', tint: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' },
  message: { icon: 'chat', tint: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
  group: { icon: 'group', tint: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300' },
  story: { icon: 'eye', tint: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' },
  story_reaction: { icon: 'heart', tint: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' },
  story_reply: { icon: 'reply', tint: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300' },
};

function targetFor(notification: AppNotification): string {
  switch (notification.entityType) {
    case 'post':
    case 'comment':
      return notification.entityId ? `/post/${notification.entityId}` : '/';
    case 'story':
      return '/';
    case 'user':
      return notification.entityId ? `/u/${notification.entityId}` : '/friends';
    case 'group':
      return notification.entityId ? `/groups/${notification.entityId}` : '/groups';
    case 'conversation':
      return notification.entityId ? `/messages?c=${notification.entityId}` : '/messages';
    case 'listing':
      return '/marketplace';
    default:
      return '/';
  }
}

export default function NotificationsPage() {
  const { refreshBadges, toast } = useSession();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items: list } = await api.notifications(50);
      setItems(list);
      if (list.some((item) => !item.readAt)) {
        await api.readNotifications();
        await refreshBadges();
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load notifications', 'error');
    } finally {
      setLoading(false);
    }
  }, [refreshBadges, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 px-3 py-3 sm:px-4">
      <header className="card flex items-center gap-3 px-4 py-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
          <Icon name="bell" size={20} />
        </span>
        <div className="mr-auto">
          <h1 className="text-base font-bold text-strong">Notifications</h1>
          <p className="text-xs text-soft">Likes, comments, requests and group activity.</p>
        </div>
        <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      {loading ? (
        <div className="card divide-y divide-[var(--border-subtle)]">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Nothing here yet"
          description="When people like, comment or send you a friend request, it shows up here."
        />
      ) : (
        <div className="card divide-y divide-[var(--border-subtle)] overflow-hidden">
          {items.map((notification) => {
            const meta = META[notification.type] ?? META.like;
            return (
              <Link
                key={notification.id}
                to={targetFor(notification)}
                className={`flex items-start gap-3 px-4 py-3 transition hover:bg-[var(--surface-muted)] ${
                  notification.readAt ? '' : 'bg-brand-50/50 dark:bg-brand-500/5'
                }`}
              >
                <div className="relative">
                  <Avatar user={notification.actor} size={42} />
                  <span className={`absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full ring-2 ring-white dark:ring-[#0d1117] ${meta.tint}`}>
                    <Icon name={meta.icon} size={12} filled={meta.icon === 'heart'} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-strong">
                    {notification.actor && <span className="font-semibold">{notification.actor.name} </span>}
                    {notification.message}
                  </p>
                  <p className="mt-0.5 text-[0.7rem] text-soft">{timeAgo(notification.createdAt)}</p>
                </div>
                {!notification.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
