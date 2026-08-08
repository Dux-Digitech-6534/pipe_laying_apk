// Pour Card detail — header card, entries grouped by Pipe ID, then the actions.
//
// Entries group by Pipe ID rather than showing seven separate tables: one "Add"
// writes across seven child tables under one shared Pipe ID, so that group is
// the unit the user actually created and wants to check.

import { useMemo, useState } from 'react';
import { fmt, fmtDate, fmtWhen, num } from '../calc';
import { isLocalName } from '../db';
import { ApiError, deleteLayingBatch } from '../api';
import { sync } from '../sync';
import { useStore } from '../store';
import { navigate } from '../router';
import {
  Confirm,
  EmptyState,
  Note,
  Skeleton,
  StatusChip,
  useToast,
} from '../components/Feedback';
import {
  IconAlert,
  IconCalculator,
  IconChevronDown,
  IconCloudOff,
  IconLayers,
  IconPlus,
  IconSend,
  IconSparkle,
  IconTrash,
} from '../icons';
import type { CardDetail as Detail, ChildRow, OutboxOp } from '../types';

interface Props {
  card: Detail | null;
  cardName: string;
  loading: boolean;
  queued: OutboxOp[];
  onReload: () => void;
}

/** One Pipe ID's worth of rows, gathered from every child table. */
interface Entry {
  pipeId: string;
  date: string | null;
  pipe?: ChildRow;
  soft?: ChildRow;
  hard?: ChildRow;
  murum?: ChildRow;
  cc?: ChildRow;
  soil?: ChildRow;
  acc: ChildRow[];
}

export function CardDetailScreen({ card, cardName, loading, queued, onReload }: Props) {
  const { t, caps, syncState } = useStore();
  const toast = useToast();
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const local = isLocalName(cardName);

  const pendingBatches = queued.filter(
    (op) => op.kind === 'add_laying_batch' && op.pourCard === cardName,
  );
  const pendingSubmit = queued.some(
    (op) => op.kind === 'submit_card' && op.pourCard === cardName,
  );

  /** Child rows keyed by Pipe ID.
   *
   *  NOTE the desk popup writes CC rows WITHOUT a pipe_id (it omits the field
   *  for that one table), so older CC rows have no key. They're bucketed by
   *  date rather than dropped. */
  const entries = useMemo<Entry[]>(() => {
    if (!card) return [];

    const map = new Map<string, Entry>();

    const ensure = (pipeId: string | null, date: unknown): Entry => {
      const key = pipeId || `(${String(date ?? 'unkeyed')})`;
      if (!map.has(key)) {
        map.set(key, { pipeId: key, date: date ? String(date) : null, acc: [] });
      }
      const entry = map.get(key)!;
      if (!entry.date && date) entry.date = String(date);
      return entry;
    };

    for (const row of card.pipe) ensure(row.pipe_id, row.date_of_pipelaying).pipe = row;
    for (const row of card.soft) ensure(row.pipe_id, row.date_soft_rock).soft = row;
    for (const row of card.hard) ensure(row.pipe_id, row.hard_rocks_date).hard = row;
    for (const row of card.murum) ensure(row.pipe_id, row.hard_rocks_date).murum = row;
    for (const row of card.cc) ensure(row.pipe_id, row.date_of_cc_road).cc = row;
    for (const row of card.soil) ensure(row.pipe_id, row.date).soil = row;
    for (const row of card.acc) ensure(row.pipe_id, row.date_accessories).acc.push(row);

    return [...map.values()].sort((a, b) =>
      b.pipeId.localeCompare(a.pipeId, undefined, { numeric: true }),
    );
  }, [card]);

  const doSubmit = async () => {
    setConfirmSubmit(false);
    await sync.queueSubmit(cardName);

    if (syncState.online) {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      onReload();
      toast.ok(t('submit_card'));
    } else {
      toast.info(t('submit_needs_online'));
    }
  };

  const doDelete = async () => {
    const pipeId = confirmDelete;
    setConfirmDelete(null);
    if (!pipeId) return;
    if (!syncState.online) {
      toast.err(t('edit_needs_online'));
      return;
    }
    setDeleting(true);
    try {
      await deleteLayingBatch(cardName, pipeId);
      toast.ok(t('entry_deleted'));
      onReload();
    } catch (error) {
      toast.err(error instanceof ApiError ? error.message : t('error_generic'));
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !card && !local) {
    return (
      <div className="pane">
        <div className="pad">
          <Skeleton height={90} count={4} />
        </div>
      </div>
    );
  }

  // A card that exists only in the outbox has no server document yet. Show what
  // we queued so the user can carry on adding entries.
  if (!card) {
    const queuedHeader = queued.find(
      (op) => op.kind === 'save_card' && op.localName === cardName,
    )?.payload;

    return (
      <>
        <div className="pane">
          <div className="pad">
            <Note kind="warn" icon={<IconCloudOff />} style={{ marginBottom: 14 }}>
              {t('saved_offline')}
            </Note>

            {queuedHeader ? (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="gradline" />
                <div style={{ padding: 14 }}>
                  <div className="kvgrid">
                    <Cell k={t('project')} v={queuedHeader.townproject} />
                    <Cell k={t('contractor')} v={queuedHeader.select_contractor} />
                    <Cell
                      k={`${t('zone')} / ${t('village')}`}
                      v={[queuedHeader.zone_name, queuedHeader.village_name]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                    <Cell
                      k={t('junction')}
                      v={`${queuedHeader.from_junction} → ${queuedHeader.to_junction}`}
                      mono
                    />
                  </div>
                </div>
              </div>
            ) : (
              // The placeholder resolved to a real card and the route is being
              // redirected, or the queued op was discarded. Either way there is
              // nothing to show here for more than a moment.
              <EmptyState
                icon={<IconAlert />}
                title={t('card_not_here')}
                body={t('card_not_here_hint')}
              />
            )}

            {pendingBatches.length ? (
              <Note kind="info" icon={<IconSparkle />} style={{ marginTop: 14 }}>
                {t('queued_n', { n: pendingBatches.length })}
              </Note>
            ) : null}
          </div>
        </div>

        <div className="actionbar">
          <button
            className="btn primary"
            onClick={() => navigate({ name: 'laying', id: cardName })}
          >
            <IconPlus />
            <span>{t('add_laying')}</span>
          </button>
        </div>
      </>
    );
  }

  const canAdd = card.docstatus !== 2 && (card.can_write || caps.write);
  const canSubmit = card.docstatus === 0 && (card.can_submit || caps.submit) && !pendingSubmit;

  return (
    <>
      <div className="pane">
        <div className="pad">
          {pendingBatches.length ? (
            <Note kind="info" icon={<IconSparkle />} style={{ marginBottom: 14 }}>
              {t('queued_n', { n: pendingBatches.length })}
            </Note>
          ) : null}

          {pendingSubmit ? (
            <Note kind="warn" icon={<IconSparkle />} style={{ marginBottom: 14 }}>
              {t('submit_queued')}
            </Note>
          ) : null}

          {/* ---------------------------------------------------- header */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="gradline" />
            <div style={{ padding: 14 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}
              >
                <span
                  className="num"
                  style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-data)' }}
                >
                  {card.name}
                </span>
                <span style={{ flex: '1 1 auto' }} />
                <StatusChip docstatus={card.docstatus} t={t} />
              </div>

              <div className="kvgrid">
                <Cell k={t('project')} v={card.project} />
                <Cell k={t('contractor')} v={card.contractor} />
                <Cell
                  k={`${t('zone')} / ${t('village')}`}
                  v={[card.zone, card.village].filter(Boolean).join(' · ')}
                />
                <Cell
                  k={t('junction')}
                  v={`${card.from_junction} → ${card.to_junction}`}
                  mono
                />
                <Cell k={t('component')} v={card.component} />
                <Cell k={t('total_quantity')} v={fmt(card.total_quantity, 0)} mono />
              </div>
            </div>
          </div>

          {card.material_issue ? (
            <Note kind="ok" icon={<IconSparkle />} style={{ marginTop: 12 }}>
              {t('submit_done', { name: card.material_issue })}
            </Note>
          ) : null}

          {/* --------------------------------------------------- entries */}
          <div className="sec">
            <div className="sec-h">
              <IconLayers />
              <h3>{t('entries')}</h3>
              <span className="cnt">
                <b>{entries.length}</b>
              </span>
            </div>

            {!entries.length ? (
              <div className="empty-sec">{t('no_entries')}</div>
            ) : (
              entries.map((entry) => {
                const pipeId = entry.pipe?.pipe_id ? String(entry.pipe.pipe_id) : null;
                const canEdit = card.docstatus === 0 && card.can_write && !local && !!pipeId;
                return (
                  <EntryCard
                    key={entry.pipeId}
                    entry={entry}
                    open={open === entry.pipeId}
                    onToggle={() => setOpen(open === entry.pipeId ? null : entry.pipeId)}
                    t={t}
                    canEdit={canEdit}
                    busy={deleting}
                    onEdit={() =>
                      pipeId && navigate({ name: 'edit-laying', id: card.name, pipeId })
                    }
                    onDelete={() => pipeId && setConfirmDelete(pipeId)}
                  />
                );
              })
            )}
          </div>

          {card.pipe.length ? (
            <button
              className="btn secondary"
              style={{ marginTop: 16 }}
              onClick={() => navigate({ name: 'backfill', id: card.name })}
            >
              <IconCalculator />
              <span>{t('backfilling')}</span>
            </button>
          ) : null}

          <div
            style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              textAlign: 'center',
              marginTop: 18,
            }}
          >
            {fmtWhen(card.modified)}
          </div>
        </div>
      </div>

      <div className="actionbar">
        <div className="btn-row">
          {canAdd ? (
            <button
              className="btn primary"
              onClick={() => navigate({ name: 'laying', id: card.name })}
              style={{ flex: canSubmit ? '1 1 0' : '1 1 100%' }}
            >
              <IconPlus />
              <span>{t('add_laying')}</span>
            </button>
          ) : null}
          {canSubmit ? (
            <button className="btn secondary" onClick={() => setConfirmSubmit(true)}>
              <IconSend />
              <span>{t('submit_card')}</span>
            </button>
          ) : null}
        </div>
      </div>

      <Confirm
        open={confirmSubmit}
        title={t('submit_confirm_title')}
        body={t('submit_confirm_body')}
        confirmLabel={t('submit_card')}
        cancelLabel={t('cancel')}
        onConfirm={doSubmit}
        onCancel={() => setConfirmSubmit(false)}
      />

      <Confirm
        open={!!confirmDelete}
        title={t('delete_entry_title')}
        body={t('delete_entry_body', { name: confirmDelete ?? '' })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}

function Cell({
  k,
  v,
  mono,
}: {
  k: string;
  v: string | null | undefined;
  mono?: boolean;
}) {
  const empty = !v;
  return (
    <div>
      <div className="k">{k}</div>
      <div className={`v${mono ? ' mono' : ''}${empty ? ' empty' : ''}`}>{v || '—'}</div>
    </div>
  );
}

function EntryCard({
  entry,
  open,
  onToggle,
  t,
  canEdit,
  busy,
  onEdit,
  onDelete,
}: {
  entry: Entry;
  open: boolean;
  onToggle: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  canEdit?: boolean;
  busy?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const pipe = entry.pipe;
  const trench = num(pipe?.pipe_calculated_qty);

  return (
    <div className="entry">
      <button className="entry-head" onClick={onToggle}>
        <span className="pid">{entry.pipeId}</span>
        <span className="when">{fmtDate(entry.date)}</span>
        <span className="spacer" />
        <span className="tq">
          {fmt(trench, 3)} <small style={{ fontWeight: 400 }}>{t('cum')}</small>
        </span>
        <IconChevronDown size="sm" className={open ? 'open' : ''} />
      </button>

      {open ? (
        <div className="entry-body">
          {pipe?.pipe_details ? (
            <Row
              label={t('pipe_details')}
              main={String(pipe.pipe_details)}
              qty={num(pipe.pipe_calculated_qty)}
              unit={t('cum')}
              pid={entry.pipeId}
            />
          ) : null}

          <Dim
            label={t('excavation')}
            l={num(pipe?.length_of_pipemtr)}
            w={num(pipe?.width_of_pipemtr)}
            d={num(pipe?.depth_of_pipemtr)}
            qty={trench}
            unit={t('cum')}
          />

          {entry.cc ? (
            <Dim
              label={t('cc_road')}
              l={num(entry.cc.cc_road_badding_length)}
              w={num(entry.cc.cc_road_badding_width)}
              d={num(entry.cc.cc_road_breaking_depth)}
              unit={t('cum')}
            />
          ) : null}

          {entry.soft ? (
            <Dim
              label={t('soft_rock')}
              l={num(entry.soft.lengthmtr)}
              w={num(entry.soft.widthmtr)}
              d={num(entry.soft.depthmtr)}
              unit={t('cum')}
            />
          ) : null}

          {entry.hard ? (
            <Dim
              label={t('hard_rock')}
              l={num(entry.hard.hard_rock_lengthmtr)}
              w={num(entry.hard.hard_rock_widthmtr)}
              d={num(entry.hard.hard_rock_depthmtr)}
              unit={t('cum')}
            />
          ) : null}

          {entry.murum ? (
            <Dim
              label={t('murum')}
              l={num(entry.murum.hard_rock_lengthmtr)}
              w={num(entry.murum.hard_rock_widthmtr)}
              d={num(entry.murum.hard_rock_depthmtr)}
              unit={t('cum')}
            />
          ) : null}

          {entry.soil ? (
            <Row
              label={t('soil_excavation')}
              main={t('soil_formula')}
              qty={num(entry.soil.soil_excavation_qty)}
              unit={t('cum')}
            />
          ) : null}

          {num(pipe?.custom_bedding) ? (
            <Row
              label={t('bedding')}
              main={`${fmt(num(pipe?.custom_bedding), 3)} ${t('mtr')}`}
            />
          ) : null}

          {entry.acc.map((row, index) => (
            <Row
              key={index}
              label={t('accessories')}
              main={String(row.accessories ?? '—')}
              qty={num(row.qauntity)}
              unit={t('quantity')}
              precision={0}
            />
          ))}

          {pipe?.custom_remark ? (
            <Row label={t('remark')} main={String(pipe.custom_remark)} />
          ) : null}

          {canEdit ? (
            <div className="entry-actions">
              <button type="button" className="entry-act" onClick={onEdit} disabled={busy}>
                {t('edit')}
              </button>
              <button
                type="button"
                className="entry-act danger"
                onClick={onDelete}
                disabled={busy}
              >
                <IconTrash size="sm" />
                <span>{t('delete')}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A `.drow` line: label + detail on the left, quantity on the right. */
function Row({
  label,
  main,
  qty,
  unit,
  precision = 3,
  pid,
}: {
  label: string;
  main: string;
  qty?: number;
  unit?: string;
  precision?: number;
  pid?: string;
}) {
  return (
    <div className="drow">
      {pid ? <span className="pid">{pid}</span> : null}
      <div className="dmeta">
        <div className="dl">{label}</div>
        <div className="ds">{main}</div>
      </div>
      {qty !== undefined ? (
        <div className="dq">
          {fmt(qty, precision)}
          {unit ? <small>{unit}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

/** L × W × D with its product. */
function Dim({
  label,
  l,
  w,
  d,
  qty,
  unit,
}: {
  label: string;
  l: number;
  w: number;
  d: number;
  qty?: number;
  unit?: string;
}) {
  if (!l && !w && !d) return null;
  const product = qty ?? (l && w && d ? l * w * d : 0);

  return (
    <Row
      label={label}
      main={`${fmt(l, 2)} × ${fmt(w, 2)} × ${fmt(d, 2)}`}
      qty={product || undefined}
      unit={unit}
    />
  );
}
