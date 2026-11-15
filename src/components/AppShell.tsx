import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { bindBackButton } from '../lib/telegram';
import { useSession } from '../state/session';
import { Icon, Logo, type IconName } from './icons';
import { Avatar, ToastHost } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
  adminOnly?: boolean;
}

const primaryNav: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/friends', label: 'Friends', icon: 'users' },
  { to: '/watch', label: 'Watch', icon: 'video' },
  { to: '/marketplace', label: 'Marketplace', icon: 'shop' },
  { to: '/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/messages', label: 'Messages', icon: 'chat' },
  { to: '/groups', label: 'Groups', icon: 'group' },
  { to: '/profile', label: 'Profile', icon: 'user' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/admin', label: 'Admin', icon: 'shield', adminOnly: true },
];

const mobileNav: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/friends', label: 'Friends', icon: 'users' },
  { to: '/watch', label: 'Watch', icon: 'video' },
  { to: '/notifications', label: 'Alerts', icon: 'bell' },
  { to: '/messages', label: 'Chats', icon: 'chat' },
];

const rootPaths = new Set(['/', '/friends', '/watch', '/notifications', '/messages', '/groups', '/marketplace', '/settings', '/profile']);

function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 grid min-w-[1.1rem] place-items-center rounded-full bg-[#e5484d] px-1 text-[0.62rem] font-bold leading-[1.1rem] text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { user, badges, theme, toggleTheme, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    return bindBackButton(!rootPaths.has(location.pathname), () => navigate(-1));
  }, [location.pathname, navigate]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);

  if (!user) return null;

  const withBadges = (item: NavItem): NavItem => ({
    ...item,
    badge: item.to === '/notifications' ? badges.notifications : item.to === '/messages' ? badges.messages : undefined,
  });

  return (
    <div className="min-h-full bg-[var(--surface-muted)]">
      {/* Mobile top bar */}
      <header className="nav-surface sticky top-0 z-30 border-b border-subtle backdrop-blur-xl lg:hidden">
        <div className="safe-top flex items-center gap-2 px-3 py-2">
          <Link to="/" className="flex items-center gap-2" aria-label="TJ Social home">
            <Logo size={32} />
            <span className="text-[1.05rem] font-extrabold tracking-tight text-strong">
              TJ<span className="text-brand-600"> Social</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-0.5">
            <Link to="/search" className="icon-btn" aria-label="Search">
              <Icon name="search" size={20} />
            </Link>
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
            </button>
            <button className="icon-btn" onClick={() => setMoreOpen(true)} aria-label="More">
              <Icon name="menu" size={20} />
            </button>
            <Link to="/profile" className="ml-1" aria-label="Your profile">
              <Avatar user={user} size={30} />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1180px] gap-6 px-0 lg:px-6">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-1 py-5 lg:flex">
          <Link to="/" className="mb-4 flex items-center gap-2.5 px-2" aria-label="TJ Social home">
            <Logo size={38} />
            <span className="text-xl font-extrabold tracking-tight text-strong">
              TJ<span className="text-brand-600"> Social</span>
            </span>
          </Link>
          <Link to="/search" className="mb-2 flex items-center gap-2 rounded-xl bg-[var(--surface)] px-3 py-2 text-sm text-soft shadow-sm ring-1 ring-[var(--border-subtle)]">
            <Icon name="search" size={18} />
            Search TJ Social
          </Link>
          <nav className="flex flex-col gap-0.5">
            {primaryNav
              .filter((item) => !item.adminOnly || user.isAdmin)
              .map((item) => {
                const withBadge = withBadges(item);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[0.95rem] font-semibold transition ${
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'text-soft hover:bg-[var(--surface)] hover:text-strong'
                      }`
                    }
                  >
                    <span className="relative">
                      <Icon name={item.icon} size={22} />
                      <Badge count={withBadge.badge} />
                    </span>
                    {item.label}
                  </NavLink>
                );
              })}
          </nav>
          <button className="btn btn-soft mt-3" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <div className="mt-auto flex items-center gap-2 rounded-2xl bg-[var(--surface)] p-2.5 shadow-sm ring-1 ring-[var(--border-subtle)]">
            <Link to="/profile">
              <Avatar user={user} size={36} />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-strong">{user.name}</p>
              <p className="truncate text-xs text-soft">@{user.handle}</p>
            </div>
            <button className="icon-btn" onClick={() => void logout()} aria-label="Log out">
              <Icon name="logout" size={18} />
            </button>
          </div>
        </aside>

        <main className="min-h-[calc(100vh-3.5rem)] w-full min-w-0 pb-24 lg:pb-10 lg:pt-5">
          {children ?? <Outlet />}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="nav-surface safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-subtle backdrop-blur-xl lg:hidden">
        <div className="flex items-stretch justify-around px-1 pb-1 pt-1.5">
          {mobileNav.map((item) => {
            const withBadge = withBadges(item);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1 text-[0.65rem] font-semibold transition ${
                    isActive ? 'text-brand-600' : 'text-soft'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon name={item.icon} size={23} filled={isActive} />
                      <Badge count={withBadge.badge} />
                    </span>
                    {item.label}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Mobile "more" sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div className="animate-rise absolute inset-x-0 bottom-0 rounded-t-3xl bg-[var(--surface)] p-4 pb-8 shadow-float">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--border-subtle)]" />
            <div className="grid grid-cols-3 gap-2">
              {[
                { to: '/marketplace', label: 'Marketplace', icon: 'shop' as IconName },
                { to: '/groups', label: 'Groups', icon: 'group' as IconName },
                { to: '/profile', label: 'Profile', icon: 'user' as IconName },
                { to: '/settings', label: 'Settings', icon: 'settings' as IconName },
                { to: '/search', label: 'Search', icon: 'search' as IconName },
                ...(user.isAdmin ? [{ to: '/admin', label: 'Admin', icon: 'shield' as IconName }] : []),
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex flex-col items-center gap-1.5 rounded-2xl bg-[var(--surface-muted)] px-2 py-3 text-xs font-semibold text-strong"
                >
                  <Icon name={item.icon} size={22} />
                  {item.label}
                </Link>
              ))}
              <button
                onClick={toggleTheme}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-[var(--surface-muted)] px-2 py-3 text-xs font-semibold text-strong"
              >
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={22} />
                {theme === 'dark' ? 'Light' : 'Dark'}
              </button>
              <button
                onClick={() => void logout()}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-[var(--surface-muted)] px-2 py-3 text-xs font-semibold text-[#b42318]"
              >
                <Icon name="logout" size={22} />
                Log out
              </button>
            </div>
          </div>
        </div>
      )}
      <ToastHost />
    </div>
  );
}
