// App shell — appbar, sync bar, routed screen, bottom tabs.

import { useCallback, useEffect, useState } from 'react';
import { ApiError, fetchCard } from './api';
import { cardKey, resolveLocalName, sync } from './sync';
import { isLocalName, kvGet, kvSet } from './db';
import { useStore } from './store';
import { goBack, isTabRoute, navigate, replace, useRoute, type Route } from './router';
import { Home } from './screens/Home';
import { Login } from './screens/Login';
import { Cards } from './screens/Cards';
import { NewCard } from './screens/NewCard';
import { MaterialTransfer } from './screens/MaterialTransfer';
import { CardDetailScreen } from './screens/CardDetail';
import { LayingDetails } from './screens/LayingDetails';
import { Backfilling } from './screens/Backfilling';
import { SyncScreen } from './screens/SyncScreen';
import { Settings } from './screens/Settings';
import { ToastHost } from './components/Feedback';
import {
  IconAlert,
  IconBox,
  IconChevronLeft,
  IconCloudCheck,
  IconCloudOff,
  IconHome,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconSync,
} from './icons';
import { Mark } from './components/Mark';
import type { CardDetail, OutboxOp } from './types';

export function App() {
  const { t, ready, needsLogin, caps, syncState } = useStore();
  const route = useRoute();

  const [card, setCard] = useState<CardDetail | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [queued, setQueued] = useState<OutboxOp[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  // Whether this device has ever held a session, so the sign-in screen can tell
  // "you were signed out" apart from "you were never signed in".
  const [hadSession] = useState(() => localStorage.getItem('plm.hadSession') === '1');
  useEffect(() => {
    if (caps.user) localStorage.setItem('plm.hadSession', '1');
  }, [caps.user]);

  const cardId =
    route.name === 'card' ||
    route.name === 'laying' ||
    route.name === 'backfill' ||
    route.name === 'edit-laying'
      ? route.id
      : null;

  const reloadCard = useCallback(() => setReloadToken((token) => token + 1), []);

  // Load whichever card the current route needs, cache-first so returning to a
  // card is instant and works with no signal.
  useEffect(() => {
    if (!cardId) {
      setCard(null);
      return;
    }

    let cancelled = false;

    (async () => {
      // A card addressed by its offline placeholder has no server document to
      // fetch — unless it has since synced, in which case redirect to the real
      // one. Replace (not push) so Back doesn't walk into a dead placeholder.
      if (isLocalName(cardId)) {
        const real = await resolveLocalName(cardId);
        if (cancelled) return;

        if (real) {
          replace(
            route.name === 'laying'
              ? { name: 'laying', id: real }
              : route.name === 'backfill'
                ? { name: 'backfill', id: real }
                : { name: 'card', id: real },
          );
          return;
        }

        setCard(null);
        setCardLoading(false);
        return;
      }

      setCardLoading(true);

      const cached = await kvGet<CardDetail>(cardKey(cardId));
      if (!cancelled && cached) {
        setCard(cached);
        setCardLoading(false);
      }

      try {
        const fresh = await fetchCard(cardId);
        if (cancelled) return;
        setCard(fresh);
        await kvSet(cardKey(cardId), fresh);
      } catch (error) {
        if (cancelled) return;
        // Offline with nothing cached is the only case worth surfacing; a stale
        // copy on screen is better than an error.
        if (!cached && error instanceof ApiError && error.kind !== 'network') {
          setCard(null);
        }
      } finally {
        if (!cancelled) setCardLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cardId, reloadToken, syncState.lastSyncAt]);

  useEffect(() => {
    let cancelled = false;
    void sync.pending().then((ops) => {
      if (!cancelled) setQueued(ops);
    });
    return () => {
      cancelled = true;
    };
  }, [syncState.queued, syncState.failed, syncState.lastSyncAt]);

  if (!ready) {
    return (
      <div className="shell">
        <div className="login">
          <div className="brandtile">
            <Mark />
          </div>
          <h1>{t('app_name')}</h1>
          <p className="lead">{t('loading')}</p>
        </div>
      </div>
    );
  }

  // No session AND nothing cached to work from: the only useful thing to offer
  // is a way in. If capabilities WERE cached, the user has a usable offline app
  // and shouldn't be pushed to a login page they may not be able to reach.
  if (needsLogin && !caps.user) {
    // "Expired" is only true if this device had a session before. A first-time
    // visitor just needs to sign in, and telling them something expired is wrong.
    return <Login reason={hadSession ? 'expired' : 'guest'} />;
  }

  return (
    <ToastHost>
      <div className="shell">
        <AppBar route={route} card={card} />
        <SyncBar />
        <Screen
          route={route}
          card={card}
          cardLoading={cardLoading}
          queued={queued}
          onReload={reloadCard}
        />
        <TabBar route={route} />
      </div>
    </ToastHost>
  );
}

// ------------------------------------------------------------------ appbar

function AppBar({ route, card }: { route: Route; card: CardDetail | null }) {
  const { t } = useStore();
  const onTab = isTabRoute(route);

  const titles: Record<Route['name'], string> = {
    home: t('app_name'),
    cards: t('nav_cards'),
    new: t('new_pour_card'),
    transfer: t('material_transfer'),
    card: card?.name ?? t('card_detail'),
    laying: t('laying_details'),
    'edit-laying': t('edit_entry'),
    backfill: t('backfilling'),
    sync: t('sync_queue'),
    settings: t('settings'),
  };

  const subtitles: Partial<Record<Route['name'], string | undefined>> = {
    home: t('brand_sub'),
    card: card ? [card.village, card.zone].filter(Boolean).join(' · ') : undefined,
    laying: card?.name,
    backfill: card?.name,
  };

  return (
    <div className="appbar">
      {onTab ? (
        <div className="brandmark">
          <Mark />
        </div>
      ) : (
        <button className="iconbtn" onClick={() => goBack()} aria-label="Back">
          <IconChevronLeft />
        </button>
      )}

      <div className="appbar-title">
        <h1>{titles[route.name]}</h1>
        {subtitles[route.name] ? <div className="sub">{subtitles[route.name]}</div> : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- syncbar

/** One-line connection + queue state. Only shown when there is something to
 *  say — a permanently visible "online" strip is noise. */
function SyncBar() {
  const { t, syncState } = useStore();

  const offline = !syncState.online;
  const hasQueue = syncState.queued > 0;
  const hasFailed = syncState.failed > 0;

  if (!offline && !hasQueue && !hasFailed && !syncState.syncing) return null;

  const kind = offline ? 'offline' : hasFailed ? 'err' : 'pending';

  return (
    <div className={`syncbar ${kind}`}>
      {offline ? (
        <IconCloudOff />
      ) : syncState.syncing ? (
        <IconSync className="spin" />
      ) : hasFailed ? (
        <IconAlert />
      ) : (
        <IconCloudCheck />
      )}

      <span>
        {offline
          ? hasQueue
            ? `${t('offline')} · ${t('queued_n', { n: syncState.queued })}`
            : t('offline')
          : syncState.syncing
            ? t('syncing')
            : hasFailed
              ? t('failed_n', { n: syncState.failed })
              : t('queued_n', { n: syncState.queued })}
      </span>

      <span className="spacer" />

      {!offline && !syncState.syncing ? (
        <button onClick={() => void sync.flush(true)}>{t('sync_now')}</button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ screen

function Screen({
  route,
  card,
  cardLoading,
  queued,
  onReload,
}: {
  route: Route;
  card: CardDetail | null;
  cardLoading: boolean;
  queued: OutboxOp[];
  onReload: () => void;
}) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'cards':
      return <Cards initialStatus={route.status} />;
    case 'new':
      return <NewCard />;
    case 'transfer':
      return <MaterialTransfer />;
    case 'card':
      return (
        <CardDetailScreen
          card={card}
          cardName={route.id}
          loading={cardLoading}
          queued={queued}
          onReload={onReload}
        />
      );
    case 'laying':
      return <LayingDetails card={card} cardName={route.id} onAdded={onReload} />;
    case 'edit-laying':
      return (
        <LayingDetails
          card={card}
          cardName={route.id}
          editPipeId={route.pipeId}
          onAdded={onReload}
        />
      );
    case 'backfill':
      return <Backfilling card={card} onReload={onReload} />;
    case 'sync':
      return <SyncScreen />;
    case 'settings':
      return <Settings />;
  }
}

// ------------------------------------------------------------------ tabbar

function TabBar({ route }: { route: Route }) {
  const { t, syncState, caps } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);

  // The bottom bar stays put on tab screens. On a pushed screen (a form with its
  // own sticky action bar) it would compete with the primary action.
  if (!isTabRoute(route)) return null;

  const pending = syncState.queued + syncState.failed;

  const go = (next: Route) => {
    setMenuOpen(false);
    navigate(next);
  };

  return (
    <>
      {/* The centre + is a "create" menu: it offers both a Pour Card and a
          Material Transfer, so neither needs its own bottom-bar slot. */}
      {menuOpen ? (
        <div className="fab-scrim" onClick={() => setMenuOpen(false)}>
          <div className="fab-menu" role="menu" onClick={(event) => event.stopPropagation()}>
            <button
              className="fab-menu-item"
              onClick={() => go({ name: 'new' })}
              disabled={!caps.create}
            >
              <span className="fmi-ic">
                <IconLayers />
              </span>
              <span className="fmi-tx">
                <b>{t('new_pour_card')}</b>
                <small>{t('new_pour_card_sub')}</small>
              </span>
            </button>
            <button className="fab-menu-item" onClick={() => go({ name: 'transfer' })}>
              <span className="fmi-ic">
                <IconBox />
              </span>
              <span className="fmi-tx">
                <b>{t('new_material_transfer')}</b>
                <small>{t('new_material_transfer_sub')}</small>
              </span>
            </button>
          </div>
        </div>
      ) : null}

      <div className="tabbar">
        <button
          className={`tab${route.name === 'home' ? ' active' : ''}`}
          onClick={() => go({ name: 'home' })}
        >
          <IconHome />
          <span>{t('nav_home')}</span>
        </button>

        <button
          className={`tab${route.name === 'cards' ? ' active' : ''}`}
          onClick={() => go({ name: 'cards' })}
        >
          <IconLayers />
          <span>{t('nav_cards')}</span>
        </button>

        <button
          className={`tab fab${route.name === 'new' ? ' active' : ''}${menuOpen ? ' menu-open' : ''}`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={t('create_new')}
          aria-expanded={menuOpen}
        >
          <span className="fab-c">
            <IconPlus />
          </span>
        </button>

        <button
          className={`tab${route.name === 'sync' ? ' active' : ''}`}
          onClick={() => go({ name: 'sync' })}
        >
          {syncState.syncing ? <IconRefresh className="spin" /> : <IconSync />}
          <span>{t('nav_sync')}</span>
          {pending ? (
            <span className={`tab-badge${syncState.failed ? ' err' : ''}`}>
              {pending > 99 ? '99+' : pending}
            </span>
          ) : null}
        </button>

        <button
          className={`tab${route.name === 'settings' ? ' active' : ''}`}
          onClick={() => go({ name: 'settings' })}
        >
          <IconSettings />
          <span>{t('nav_settings')}</span>
        </button>
      </div>
    </>
  );
}
