// Sign-in gate.
//
// The form posts straight to Frappe's own /api/method/login, same-origin, and
// keeps only the session cookie Frappe sets — no token is stored and the
// password never leaves this handler. Signing in here rather than bouncing to
// Frappe's own /login page matters inside the APK: the desk login page renders
// its full desk chrome in the WebView, and the redirect back to the hash route
// was losing the fragment on some Android builds.

import { useState } from 'react';
import { ApiError, signIn } from '../api';
import { useStore } from '../store';
import { Mark } from '../components/Mark';
import { IconLogout, IconLock, IconUser } from '../icons';

export function Login({ reason }: { reason?: 'expired' | 'guest' }) {
  const { t } = useStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError(null);

    try {
      await signIn(email.trim(), password);
      // A full load rather than a route change: the host page has to re-render
      // so boot data (CSRF token, user) reflects the new session.
      window.location.assign('/pipe-laying/m');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.kind === 'locked'
          ? // Frappe's own wording carries the wait in seconds, which is the one
            // thing the user needs; keep it rather than paraphrasing.
            `${t('account_locked')} ${caught.message}`
          : caught instanceof ApiError && caught.kind === 'auth'
            ? t('invalid_login')
            : caught instanceof ApiError && caught.kind === 'network'
              ? t('working_offline')
              : t('error_generic'),
      );
      setBusy(false);
    }
  };

  return (
    <div className="shell">
      <form className="login" onSubmit={submit} noValidate>
        <div className="brandtile">
          <Mark />
        </div>

        <h1>{t('app_name')}</h1>
        <p className="lead">
          {reason === 'expired' ? t('session_expired') : t('login_lead')}
        </p>

        {error ? (
          <div className="login-err" role="alert">
            {error}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="plm-email">{t('email')}</label>
          <div className="control">
            <span className="ic">
              <IconUser />
            </span>
            <input
              id="plm-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t('email_ph')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="plm-password">{t('password')}</label>
          <div className="control">
            <span className="ic">
              <IconLock />
            </span>
            <input
              id="plm-password"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder={t('password_ph')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setReveal((current) => !current)}
              tabIndex={-1}
              aria-label={t(reveal ? 'hide' : 'show')}
            >
              {t(reveal ? 'hide' : 'show')}
            </button>
          </div>
        </div>

        <button className="btn primary login-submit" type="submit" disabled={!ready}>
          {busy ? (
            <span>{t('signing_in')}</span>
          ) : (
            <>
              <IconLogout />
              <span>{t('sign_in')}</span>
            </>
          )}
        </button>

        <div className="foot">
          {t('brand_sub')} · <b>DUX Digitech</b>
        </div>
      </form>
    </div>
  );
}
