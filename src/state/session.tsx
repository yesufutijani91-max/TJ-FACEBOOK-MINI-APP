import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppSettings, FeatureFlags, SessionInfo, User } from '../../shared/types';
import { api, ApiError, tokenStore, type AuthResult } from '../lib/api';
import { bootTelegram, initDataRaw, isTelegram, telegramUser } from '../lib/telegram';

interface SessionState {
  user: User | null;
  loading: boolean;
  error: string | null;
  mode: 'supabase' | 'local';
  features: FeatureFlags;
  settings: AppSettings | null;
  badges: { notifications: number; messages: number };
  loginWithTelegram: () => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  refreshBadges: () => Promise<void>;
  refreshSession: () => Promise<void>;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  toast: (message: string, kind?: 'info' | 'success' | 'error') => void;
  toasts: { id: number; message: string; kind: 'info' | 'success' | 'error' }[];
}

const SessionContext = createContext<SessionState | null>(null);

const THEME_KEY = 'tj.social.theme';

function applyThemeClass(theme: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'dark' ? false : true);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#0d1117' : '#ffffff');
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [badges, setBadges] = useState({ notifications: 0, messages: 0 });
  const [toasts, setToasts] = useState<SessionState['toasts']>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const toastId = useRef(0);
  const bootedRef = useRef(false);

  const toast = useCallback((message: string, kind: 'info' | 'success' | 'error' = 'info') => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, kind }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3800);
  }, []);

  useEffect(() => {
    applyThemeClass(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const applyAuth = useCallback((result: AuthResult) => {
    tokenStore.set(result.token);
    setUserState(result.user);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const { settings: loaded } = await api.adminSettings();
      setSettings(loaded);
    } catch {
      /* settings are admin-only; the public defaults are used */
    }
  }, []);

  const refreshBadges = useCallback(async () => {
    if (!tokenStore.get()) return;
    try {
      setBadges(await api.badges());
    } catch {
      /* badges are best-effort */
    }
  }, []);

  const loginWithTelegram = useCallback(async () => {
    const initData = initDataRaw();
    if (!initData) throw new ApiError('Open this app from inside Telegram to sign in.', 400);
    const result = await api.loginTelegram(initData);
    applyAuth(result);
  }, [applyAuth]);

  const loginAsGuest = useCallback(async () => {
    const prefill = telegramUser()?.first_name;
    const result = await api.loginGuest(prefill);
    applyAuth(result);
  }, [applyAuth]);

  const refreshSession = useCallback(async () => {
    const session = await api.session();
    setInfo(session);
    setUserState(session.user);
    if (session.user) await refreshBadges();
  }, [refreshBadges]);

  // Boot: read session, then authenticate with Telegram initData when present.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    const cleanupTelegram = bootTelegram();

    (async () => {
      try {
        const session = await api.session();
        setInfo(session);

        if (session.user) {
          setUserState(session.user);
        } else if (isTelegram() && session.features.telegram) {
          try {
            await loginWithTelegram();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Telegram sign-in failed');
          }
        } else if (session.features.devLogin) {
          try {
            await loginAsGuest();
          } catch {
            /* fall through to the welcome screen */
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not reach the server');
      } finally {
        setLoading(false);
      }
    })();

    return cleanupTelegram;
  }, [loginAsGuest, loginWithTelegram]);

  useEffect(() => {
    if (user) void refreshBadges();
  }, [user, refreshBadges]);

  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => void refreshBadges(), 45_000);
    return () => clearInterval(interval);
  }, [user, refreshBadges]);

  useEffect(() => {
    if (user?.isAdmin) void loadSettings();
  }, [user, loadSettings]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* clearing the local token is enough */
    }
    tokenStore.set(null);
    setUserState(null);
    setBadges({ notifications: 0, messages: 0 });
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      user,
      loading,
      error,
      mode: info?.mode ?? 'local',
      features:
        info?.features ?? { telegram: false, devLogin: false, storage: 'local', botUsername: null },
      settings,
      badges,
      loginWithTelegram,
      loginAsGuest,
      logout,
      setUser: setUserState,
      refreshBadges,
      refreshSession,
      theme,
      toggleTheme,
      toast,
      toasts,
    }),
    [
      user,
      loading,
      error,
      info,
      settings,
      badges,
      loginWithTelegram,
      loginAsGuest,
      logout,
      refreshBadges,
      refreshSession,
      theme,
      toggleTheme,
      toast,
      toasts,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
