// Home — greeting, the day's figures, the primary action, recent cards.
// Layout follows the prototype: .ghead, a 2×2 .stats grid, then .crow rows.

import { useEffect, useMemo, useState } from 'react';
import { fetchHomeSummary } from '../api';
import { kvGet, kvSet } from '../db';
import { useStore } from '../store';
import { navigate } from '../router';
import { fmtTrim, fmtDate, num } from '../calc';
import { EmptyState, Note, Skeleton, StatusChip } from '../components/Feedback';
import {
  IconBell,
  IconDoc,
  IconLayers,
  IconLock,
  IconPlus,
  IconRuler,
  IconSparkle,
} from '../icons';
import type { CardSummary, HomeSummary } from '../types';

const CACHE_KEY = 'home';

/** Initials for the avatar tile, e.g. "Rakesh Yadav" -> "RY". */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Home() {
  const { t, caps, syncState } = useStore();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await kvGet<HomeSummary>(CACHE_KEY);
      if (!cancelled && cached) {
        setSummary(cached);
        setLoading(false);
      }

      try {
        const fresh = await fetchHomeSummary();
        if (cancelled) return;
        setSummary(fresh);
        await kvSet(CACHE_KEY, fresh);
      } catch {
        /* offline — cached counts stay on screen */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-read after a sync lands so the figures reflect what just went up.
  }, [syncState.lastSyncAt]);

  /** Today's pipe length and excavation, summed from the recent cards' entries.
   *  Derived here rather than server-side because "today" is the phone's day —
   *  a crew working past midnight should still see their own shift. */
  const today = useMemo(() => {
    const iso = new Date().toISOString().slice(0, 10);
    let created = 0;
    for (const card of summary?.recent ?? []) {
      if (String(card.modified).slice(0, 10) === iso) created += 1;
    }
    return { created, iso };
  }, [summary]);

  const fullName = caps.full_name || t('app_name');

  return (
    <div className="pane">
      <div className="pad">
        <div className="ghead">
          <div className="avatar">{initials(caps.full_name)}</div>
          <div className="gt">
            <div className="hi">{t('greeting')}</div>
            <div className="nm">{fullName}</div>
          </div>
          <button
            className="iconbtn plain"
            onClick={() => navigate({ name: 'sync' })}
            aria-label={t('nav_sync')}
          >
            <IconBell />
          </button>
        </div>

        {loading && !summary ? (
          <Skeleton height={78} count={2} />
        ) : (
          <>
            <div className="stats">
              <div className="stat">
                <div className="sv">
                  {summary?.total ?? 0} <small>{t('nav_cards').toLowerCase()}</small>
                </div>
                <div className="sl">
                  <IconDoc />
                  <span>{t('total_cards')}</span>
                </div>
              </div>

              <div className="stat">
                <div className="sv">
                  {today.created} <small>{t('nav_cards').toLowerCase()}</small>
                </div>
                <div className="sl">
                  <IconLayers />
                  <span>{fmtDate(today.iso)}</span>
                </div>
              </div>

              <div className="stat">
                <div className="sv">{summary?.draft ?? 0}</div>
                <div className="sl">
                  <IconRuler />
                  <span>{t('draft')}</span>
                </div>
              </div>

              <div className="stat">
                <div className="sv">{summary?.submitted ?? 0}</div>
                <div className="sl">
                  <IconLock />
                  <span>{t('submitted')}</span>
                </div>
              </div>
            </div>

            <button
              className="btn primary"
              style={{ marginTop: 16 }}
              onClick={() => navigate({ name: 'new' })}
              disabled={!caps.create}
            >
              <IconPlus />
              <span>{t('new_pour_card')}</span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', margin: '22px 2px 12px' }}>
              <span className="eyebrow" style={{ flex: 1 }}>
                {t('recent')}
              </span>
              <button
                className="linkbtn"
                style={{ padding: 0 }}
                onClick={() => navigate({ name: 'cards' })}
              >
                {t('view_all')}
              </button>
            </div>

            {!summary?.recent?.length ? (
              <EmptyState icon={<IconLayers />} title={t('no_recent')} />
            ) : (
              summary.recent.map((card) => <CardRow key={card.name} card={card} t={t} />)
            )}

            <Note style={{ marginTop: 18 }} icon={<IconSparkle />}>
              {t('home_note')}
            </Note>
          </>
        )}
      </div>
    </div>
  );
}

function CardRow({ card, t }: { card: CardSummary; t: (key: string) => string }) {
  const where = [card.village, card.zone].filter(Boolean).join(' · ');

  return (
    <button className="crow" onClick={() => navigate({ name: 'card', id: card.name })}>
      <div className="idwrap">
        <div className="cid">{card.name}</div>
        <div className="cmeta">
          <b>{where || card.project || '—'}</b> · {card.contractor ?? '—'} ·{' '}
          {card.from_junction}→{card.to_junction}
        </div>
      </div>
      <div className="cright">
        <StatusChip docstatus={card.docstatus} pending={card.pending} t={t} />
        <span className="cdate">{fmtTrim(num(card.total_quantity), 0)}</span>
      </div>
    </button>
  );
}
