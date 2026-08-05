// Settings — account, language, theme, master-data refresh, storage.
// Rows use the prototype's `.srow` anatomy: tinted icon tile, title + hint,
// trailing control.

import { useState } from 'react';
import { boot, logout } from '../api';
import { kvClear } from '../db';
import { useStore, type ThemeChoice } from '../store';
import { Confirm, useToast } from '../components/Feedback';
import {
  IconDatabase,
  IconGlobe,
  IconLogout,
  IconMoon,
  IconRefresh,
  IconTrash,
} from '../icons';

/** "Rakesh Yadav" -> "RY" */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Settings() {
  const { t, lang, setLang, theme, setTheme, caps, masters, mastersStale, build, refresh } =
    useStore();
  const toast = useToast();

  const [refreshing, setRefreshing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      const changed = await refresh();
      toast.ok(changed ? t('masters_refreshed') : t('masters_current'));
    } catch {
      toast.err(t('offline'));
    } finally {
      setRefreshing(false);
    }
  };

  const masterCount = masters
    ? masters.projects.length +
      masters.zones.length +
      masters.villages.length +
      masters.components.length +
      masters.contractors.length +
      masters.pipe_items.length +
      masters.acc_items.length
    : 0;

  return (
    <div className="pane">
      <div className="pad">
        {/* --------------------------------------------------- account */}
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div
            className="avatar"
            style={{ width: 52, height: 52, borderRadius: 16, fontSize: 17 }}
          >
            {initials(caps.full_name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {caps.full_name || t('app_name')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('brand_sub')}</div>
            <div
              className="num"
              style={{
                fontSize: 11,
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text-muted)',
              }}
            >
              {caps.user}
            </div>
          </div>
        </div>

        {/* ----------------------------------------------- preferences */}
        <div className="card" style={{ padding: '4px 14px', marginTop: 14 }}>
          <div className="srow" style={{ cursor: 'default' }}>
            <div className="si">
              <IconGlobe size="sm" />
            </div>
            <div className="st">
              <div className="t">{t('language')}</div>
              <div className="d">{t('language_hint')}</div>
            </div>
            <div className="seg">
              <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
                EN
              </button>
              <button className={lang === 'hi' ? 'on' : ''} onClick={() => setLang('hi')}>
                हिं
              </button>
            </div>
          </div>

          <div className="srow" style={{ cursor: 'default' }}>
            <div className="si">
              <IconMoon size="sm" />
            </div>
            <div className="st">
              <div className="t">{t('theme')}</div>
              <div className="d">{t('theme_hint')}</div>
            </div>
            <div className="seg">
              {(['light', 'dark', 'system'] as ThemeChoice[]).map((option) => (
                <button
                  key={option}
                  className={theme === option ? 'on' : ''}
                  onClick={() => setTheme(option)}
                >
                  {t(option)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------ data */}
        <div className="card" style={{ padding: '4px 14px', marginTop: 14 }}>
          <button className="srow" onClick={doRefresh} disabled={refreshing}>
            <div className="si">
              <IconRefresh size="sm" className={refreshing ? 'spin' : ''} />
            </div>
            <div className="st">
              <div className="t">{t('refresh_masters')}</div>
              <div className="d">{t('masters_hint')}</div>
            </div>
            <span className="sval">
              {masterCount ? `${masterCount}${mastersStale ? '*' : ''}` : '—'}
            </span>
          </button>

          <div className="srow" style={{ cursor: 'default' }}>
            <div className="si">
              <IconDatabase size="sm" />
            </div>
            <div className="st">
              <div className="t">{t('build')}</div>
              <div className="d">{boot.site}</div>
            </div>
            <span className="sval">{String(build)}</span>
          </div>

          <button className="srow danger" onClick={() => setConfirmClear(true)}>
            <div className="si">
              <IconTrash size="sm" />
            </div>
            <div className="st">
              <div className="t">{t('clear_cache')}</div>
              <div className="d">{t('clear_cache_hint')}</div>
            </div>
          </button>
        </div>

        {/* --------------------------------------------------- account */}
        <div className="card" style={{ padding: '4px 14px', marginTop: 14 }}>
          <button className="srow danger" onClick={() => setConfirmSignOut(true)}>
            <div className="si">
              <IconLogout size="sm" />
            </div>
            <div className="st">
              <div className="t">{t('sign_out')}</div>
            </div>
          </button>
        </div>

        <div
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--text-faint)',
            marginTop: 26,
            lineHeight: 1.6,
          }}
        >
          {t('app_name')} · {t('brand_sub')}
          <br />
          DUX Digitech
        </div>
      </div>

      <Confirm
        open={confirmClear}
        title={t('clear_cache')}
        body={t('clear_cache_confirm')}
        confirmLabel={t('clear')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={async () => {
          setConfirmClear(false);
          // Read caches only. The outbox lives in its own store and is
          // deliberately untouched — clearing cache must never lose a field
          // entry that hasn't reached the server.
          await kvClear();
          toast.ok(t('cache_cleared'));
          try {
            await refresh();
          } catch {
            /* offline — it refills on the next connection */
          }
        }}
        onCancel={() => setConfirmClear(false)}
      />

      <Confirm
        open={confirmSignOut}
        title={t('sign_out')}
        confirmLabel={t('sign_out')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={async () => {
          setConfirmSignOut(false);
          await logout();
          location.href = '/login';
        }}
        onCancel={() => setConfirmSignOut(false)}
      />
    </div>
  );
}
