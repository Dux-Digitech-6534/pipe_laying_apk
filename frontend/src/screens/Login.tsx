// Sign-in gate.
//
// A branded, in-app login — the app never sends the user to Frappe's unbranded
// /login page. Credentials go straight to Frappe's own /api/method/login (same
// origin, HTTPS), which sets the session cookie; we then reload so the static
// shell re-injects the now-authenticated CSRF token and the app boots signed in.
// The password is only ever sent to authenticate — never stored.

import { useState, type FormEvent } from 'react';
import { ApiError, login as apiLogin } from '../api';
import { useStore } from '../store';
import { Mark } from '../components/Mark';
import { IconLock, IconLogout, IconUser } from '../icons';

export function Login({ reason }: { reason?: 'expired' | 'guest' }) {
  const { t } = useStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    try {
      await apiLogin(email.trim(), password);
      // Reload the app root: the shell comes back with the authenticated
      // session's CSRF token, and the SPA boots straight into Home.
      window.location.assign('/pipe-laying/m');
    } catch (err) {
      setError(
        err instanceof ApiError && err.kind === 'auth'
          ? t('invalid_login')
          : err instanceof ApiError && err.kind === 'network'
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
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder={t('password_ph')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPw((shown) => !shown)}
              tabIndex={-1}
              aria-label={showPw ? t('hide') : t('show')}
            >
              {showPw ? t('hide') : t('show')}
            </button>
          </div>
        </div>

        <button className="btn primary login-submit" type="submit" disabled={!canSubmit}>
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
