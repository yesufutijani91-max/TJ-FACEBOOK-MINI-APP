/**
 * Telegram Web Apps SDK bridge.
 *
 * The SDK is loaded from telegram.org in index.html. Everything here is
 * defensive: outside Telegram (desktop browser, preview) the calls no-op so the
 * same bundle works everywhere.
 */

export interface TelegramWebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
}

interface HapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged: () => void;
}

interface BackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

interface MainButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  show: () => void;
  hide: () => void;
  setText: (text: string) => void;
  enable: () => void;
  disable: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser; start_param?: string };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  enableClosingConfirmation: () => void;
  disableVerticalSwipes?: () => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
  HapticFeedback?: HapticFeedback;
  BackButton: BackButton;
  MainButton: MainButton;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const webApp = (): TelegramWebApp | undefined => window.Telegram?.WebApp;

export const isTelegram = (): boolean => Boolean(webApp()?.initData);

export const initDataRaw = (): string => webApp()?.initData ?? '';

/** The unverified Telegram profile, used only to prefill the UI before login. */
export const telegramUser = (): TelegramWebAppUser | undefined => webApp()?.initDataUnsafe?.user;

export function haptic(kind: 'light' | 'medium' | 'success' | 'error' | 'select' = 'light') {
  const hf = webApp()?.HapticFeedback;
  if (!hf) return;
  try {
    if (kind === 'success') hf.notificationOccurred('success');
    else if (kind === 'error') hf.notificationOccurred('error');
    else if (kind === 'select') hf.selectionChanged();
    else hf.impactOccurred(kind);
  } catch {
    /* haptics are optional */
  }
}

/**
 * Boots the Mini App: expands to full height, applies Telegram theme colours,
 * syncs the CSS custom viewport height and returns an unsubscribe function.
 */
export function bootTelegram(): () => void {
  const app = webApp();
  if (!app) return () => {};
  try {
    app.ready();
    app.expand();
    app.setHeaderColor(app.colorScheme === 'dark' ? '#0d1117' : '#ffffff');
    app.setBackgroundColor(app.colorScheme === 'dark' ? '#0d1117' : '#f4f6fa');
    app.setBottomBarColor?.(app.colorScheme === 'dark' ? '#0d1117' : '#ffffff');
    app.disableVerticalSwipes?.();
  } catch {
    /* older Telegram clients */
  }

  const syncViewport = () => {
    const height = app.viewportStableHeight || app.viewportHeight || window.innerHeight;
    document.documentElement.style.setProperty('--tg-viewport-height', `${height}px`);
  };
  syncViewport();

  const applyTheme = () => {
    const dark = app.colorScheme === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', dark ? '#0d1117' : '#ffffff');
  };
  applyTheme();

  app.onEvent('viewportChanged', syncViewport);
  app.onEvent('themeChanged', applyTheme);
  window.addEventListener('resize', syncViewport);

  return () => {
    app.offEvent('viewportChanged', syncViewport);
    app.offEvent('themeChanged', applyTheme);
    window.removeEventListener('resize', syncViewport);
  };
}

/** Wires the native Telegram back button; returns a cleanup function. */
export function bindBackButton(visible: boolean, onClick: () => void): () => void {
  const back = webApp()?.BackButton;
  if (!back) return () => {};
  if (visible) {
    back.onClick(onClick);
    back.show();
    return () => {
      back.offClick(onClick);
      back.hide();
    };
  }
  back.hide();
  return () => {};
}

/** Wires the native Telegram main button; returns a cleanup function. */
export function bindMainButton(options: {
  text: string;
  visible: boolean;
  active?: boolean;
  onClick: () => void;
}): () => void {
  const button = webApp()?.MainButton;
  if (!button) return () => {};
  if (!options.visible) {
    button.hide();
    return () => {};
  }
  button.setText(options.text);
  if (options.active === false) button.disable();
  else button.enable();
  button.onClick(options.onClick);
  button.show();
  return () => {
    button.offClick(options.onClick);
    button.hide();
  };
}
