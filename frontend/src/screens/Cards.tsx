// Pour Cards list — search, .fbar status pills, .crow rows.
//
// Cards sitting in the outbox are merged in so a card created with no signal is
// visible immediately, badged as pending rather than hidden until it syncs.

import { useEffect, useMemo, useState } from 'react';
import { fetchCards } from '../api';
import { kvGet, kvSet } from '../db';
import { KEY_CARDS, sync } from '../sync';
import { useStore } from '../store';
import { navigate } from '../router';
import { fmtWhen } from '../calc';
import { EmptyState, Skeleton, StatusChip } from '../components/Feedback';
import { IconLayers, IconSearch, IconX } from '../icons';
import type { CardSummary, OutboxOp } from '../types';

type Filter = 'all' | 'draft' | 'submitted' | 'cancelled';

const FILTERS: Filter[] = ['all', 'draft', 'submitted', 'cancelled'];

export function Cards({ initialStatus }: { initialStatus?: string }) {
  const { t, syncState } = useStore();
  const [filter, setFilter] = useState<Filter>(
    (FILTERS.includes(initialStatus as Filter) ? initialStatus : 'all') as Filter,
  );
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<CardSummary[] | null>(null);
  const [queued, setQueued] = useState<OutboxOp[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await kvGet<CardSummary[]>(KEY_CARDS);
      if (!cancelled && cached) {
        setCards(cached);
        setLoading(false);
      }

      try {
        const fresh = await fetchCards({ limit: 200 });
        if (cancelled) return;
        setCards(fresh);
        await kvSet(KEY_CARDS, fresh);
      } catch {
        /* offline — cached list stays */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [syncState.lastSyncAt]);

  useEffect(() => {
    let cancelled = false;
    void sync.pending().then((ops) => {
      if (!cancelled) setQueued(ops);
    });
    return () => {
      cancelled = true;
    };
  }, [syncState.queued, syncState.failed, syncState.lastSyncAt]);

  /** Server cards annotated with pending-batch counts, plus the cards that so
   *  far exist only on this phone. Newest first either way. */
  const merged = useMemo<CardSummary[]>(() => {
    const server = cards ?? [];
    const serverNames = new Set(server.map((card) => card.name));

    const batchCounts = new Map<string, number>();
    for (const op of queued) {
      if (op.kind === 'add_laying_batch' && op.pourCard) {
        batchCounts.set(op.pourCard, (batchCounts.get(op.pourCard) ?? 0) + 1);
      }
    }

    const localOnly: CardSummary[] = queued
      .filter(
        (op) =>
          op.kind === 'save_card' && op.localName && !serverNames.has(op.localName) && op.payload,
      )
      .map((op) => ({
        name: op.localName!,
        project: op.payload!.townproject ?? null,
        zone: op.payload!.zone_name ?? null,
        village: op.payload!.village_name ?? null,
        component: op.payload!.component ?? null,
        contractor: op.payload!.select_contractor ?? null,
        from_junction: op.payload!.from_junction ?? null,
        to_junction: op.payload!.to_junction ?? null,
        docstatus: 0 as const,
        material_issue: null,
        total_quantity: 0,
        modified: new Date(op.createdAt).toISOString(),
        owner: '',
        pending: true,
        pendingBatches: batchCounts.get(op.localName!) ?? 0,
      }));

    const annotated = server.map((card) => ({
      ...card,
      pendingBatches: batchCounts.get(card.name) ?? 0,
    }));

    return [...localOnly, ...annotated].sort(
      (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
    );
  }, [cards, queued]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: 0, draft: 0, submitted: 0, cancelled: 0 };
    for (const card of merged) {
      result.all += 1;
      if (card.docstatus === 0) result.draft += 1;
      else if (card.docstatus === 1) result.submitted += 1;
      else result.cancelled += 1;
    }
    return result;
  }, [merged]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return merged.filter((card) => {
      if (filter === 'draft' && card.docstatus !== 0) return false;
      if (filter === 'submitted' && card.docstatus !== 1) return false;
      if (filter === 'cancelled' && card.docstatus !== 2) return false;
      if (!needle) return true;

      return [
        card.name,
        card.project,
        card.zone,
        card.village,
        card.component,
        card.contractor,
        card.from_junction,
        card.to_junction,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [merged, filter, query]);

  return (
    <div className="pane">
      <div className="pad" style={{ paddingTop: 12 }}>
        <div className="control" style={{ marginBottom: 12 }}>
          <IconSearch />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search_cards')}
            inputMode="search"
            autoComplete="off"
          />
          {query ? (
            <button
              className="iconbtn plain"
              style={{ width: 26, height: 26 }}
              onClick={() => setQuery('')}
              aria-label={t('clear')}
            >
              <IconX size="sm" />
            </button>
          ) : null}
        </div>

        <div className="fbar">
          {FILTERS.map((option) => (
            <button
              key={option}
              className={`fpill${filter === option ? ' active' : ''}`}
              onClick={() => setFilter(option)}
            >
              {t(option)}
              <span className="n">{counts[option]}</span>
            </button>
          ))}
        </div>

        {loading && !cards ? (
          <Skeleton height={72} count={5} />
        ) : !visible.length ? (
          <EmptyState icon={<IconLayers />} title={t('no_cards')} body={t('no_cards_hint')} />
        ) : (
          visible.map((card) => <CardRow key={card.name} card={card} t={t} />)
        )}
      </div>
    </div>
  );
}

function CardRow({
  card,
  t,
}: {
  card: CardSummary;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const where = [card.village, card.zone].filter(Boolean).join(' · ');

  return (
    <button className="crow" onClick={() => navigate({ name: 'card', id: card.name })}>
      <div className="idwrap">
        <div className="cid">{card.pending ? t('draft').toUpperCase() : card.name}</div>
        <div className="cmeta">
          <b>{where || card.project || '—'}</b> · {card.contractor ?? '—'} ·{' '}
          {card.from_junction}→{card.to_junction}
        </div>
      </div>
      <div className="cright">
        <StatusChip docstatus={card.docstatus} pending={card.pending} t={t} />
        <span className="cdate">
          {card.pendingBatches ? `+${card.pendingBatches} · ` : ''}
          {fmtWhen(card.modified)}
        </span>
      </div>
    </button>
  );
}
