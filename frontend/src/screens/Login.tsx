// Sign-in gate.
//
// Authentication itself stays with Frappe — the app never handles a password.
// This screen hands the user to Frappe's own /login with a redirect back to the
// app, which is what keeps the session cookie (and therefore every API call)
// working inside the WebView.

import { useStore } from '../store';
import { Mark } from '../components/Mark';
import { IconLogout } from '../icons';

export function Login({ reason }: { reason?: 'expired' | 'guest' }) {
  const { t } = useStore();

  const signIn = () => {
    // Come back to exactly where we are, hash included, after login.
    const back = encodeURIComponent(location.pathname + location.hash);
    location.href = `/login?redirect-to=${back}`;
  };

  return (
    <div className="shell">
      <div className="login">
        <div className="brandtile">
          <Mark />
        </div>

        <h1>{t('app_name')}</h1>
        <p className="lead">
          {reason === 'expired' ? t('session_expired') : t('login_lead')}
        </p>

        <button className="btn primary" onClick={signIn}>
          <IconLogout />
          <span>{t('sign_in')}</span>
        </button>

        <div className="foot">
          {t('brand_sub')} · <b>DUX Digitech</b>
        </div>
      </div>
    </div>
  );
}
