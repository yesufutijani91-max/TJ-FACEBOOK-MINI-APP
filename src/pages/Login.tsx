import { useEffect, useState } from 'react';
import { Icon, Logo } from '../components/icons';
import { Spinner } from '../components/ui';
import { isTelegram, telegramUser } from '../lib/telegram';
import { useSession } from '../state/session';

export default function LoginPage() {
  const { loginWithTelegram, loginAsGuest, features, error, loading, settings } = useSession();
  const [busy, setBusy] = useState<'telegram' | 'guest' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [showGuest, setShowGuest] = useState(false);
  const telegramIdentity = telegramUser();

  useEffect(() => {
    setBusy(null);
  }, [loading]);

  const signInWithTelegram = async () => {
    setBusy('telegram');
    setLocalError(null);
    try {
      await loginWithTelegram();
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Telegram sign-in failed');
      setBusy(null);
    }
  };

  const signInAsGuest = async () => {
    setBusy('guest');
    setLocalError(null);
    try {
      await loginAsGuest(guestName.trim() || undefined);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Could not create a guest account');
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-b from-brand-50 via-white to-white px-4 py-10 dark:from-[#0b1220] dark:via-[#0d1117] dark:to-[#0d1117]">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-strong">{settings?.siteName ?? 'TJ SOCIAL'}</h1>
          <p className="mt-1 text-sm font-medium text-brand-600 dark:text-brand-300">{settings?.tagline ?? 'Connect. Share. Discover.'}</p>
        </div>

        <div className="card space-y-4 p-5 shadow-xl">
          <div className="space-y-1 text-center">
            <h2 className="text-lg font-bold text-strong">Welcome</h2>
            <p className="text-sm text-soft">
              {isTelegram()
                ? 'Sign in with your Telegram account to continue.'
                : 'Open this Mini App inside Telegram for instant sign-in, or continue as a guest below.'}
            </p>
          </div>

          {(error || localError) && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
              {localError ?? error}
            </p>
          )}

          <button className="btn btn-primary w-full py-3" onClick={() => void signInWithTelegram()} disabled={busy !== null}>
            {busy === 'telegram' ? <Spinner size={18} /> : <Icon name="send" size={18} />}
            Continue with Telegram
          </button>

          {telegramIdentity && (
            <p className="text-center text-xs text-soft">
              Detected {telegramIdentity.first_name}
              {telegramIdentity.username ? ` (@${telegramIdentity.username})` : ''}
            </p>
          )}

          {features.devLogin && (
            <div className="space-y-2 border-t border-subtle pt-4">
              {showGuest ? (
                <>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-soft">Display name (optional)</label>
                  <input
                    className="input"
                    placeholder="Guest explorer"
                    value={guestName}
                    maxLength={40}
                    onChange={(event) => setGuestName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void signInAsGuest();
                    }}
                  />
                  <button className="btn btn-soft w-full" onClick={() => void signInAsGuest()} disabled={busy !== null}>
                    {busy === 'guest' ? <Spinner size={16} /> : <Icon name="user" size={16} />}
                    Create guest account
                  </button>
                </>
              ) : (
                <button className="btn btn-soft w-full" onClick={() => setShowGuest(true)}>
                  <Icon name="user" size={16} /> Continue as guest
                </button>
              )}
              <p className="text-center text-[0.68rem] text-soft">
                Guest mode creates a temporary account so you can explore TJ SOCIAL outside Telegram.
              </p>
            </div>
          )}
        </div>

        <ul className="mt-6 grid gap-2 text-sm text-soft">
          <li className="flex items-center gap-2">
            <Icon name="users" size={16} className="text-brand-500" /> Friends, groups and communities
          </li>
          <li className="flex items-center gap-2">
            <Icon name="chat" size={16} className="text-brand-500" /> Real-time private messaging
          </li>
          <li className="flex items-center gap-2">
            <Icon name="shop" size={16} className="text-brand-500" /> Marketplace with direct seller chat
          </li>
        </ul>
      </div>
    </div>
  );
}
