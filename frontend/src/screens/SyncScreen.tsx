// Sync — what's still on the phone, and why.
//
// Field users need to know their shift's work actually landed. This screen is the
// honest answer: every queued operation, its age, its error, and the two escapes
// (retry, discard) for anything the server refused.

import { useEffect, useState } from 'react';
import { sync } from '../sync';
import { useStore } from '../store';
import { fmtWhen } from '../calc';
import { Confirm, EmptyState, Note, SectionHead, useToast } from '../components/Feedback';
import {
  IconAlert,
  IconCheck,
  IconCloudCheck,
  IconCloudOff,
  IconRefresh,
  IconSync,
  IconTrash,
} from '../icons';
import type { OutboxOp } from '../types';

export function SyncScreen() {
  const { t, syncState } = useStore();
  const toast = useToast();
  const [ops, setOps] = useState<OutboxOp[]>([]);
  const [discarding, setDiscarding] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void sync.pending().then((pending) => {
      if (!cancelled) setOps(pending);
    });
    return () => {
      cancelled = true;
    };
  }, [syncState.queued, syncState.failed, syncState.lastSyncAt, syncState.syncing]);

  const failed = ops.filter((op) => op.permanent);
  const waiting = ops.filter((op) => !op.permanent);

  const flushNow = async () => {
    const reachable = await sync.probe();
    if (!reachable) {
      toast.err(t('offline'));
      return;
    }
    await sync.flush(true);
    toast.ok(t('synced'));
  };

  return (
    <>
      <div className="pane">
        <div className="pad">
          {/* ---------------------------------------------- status summary */}
          <div className="card" style={{ textAlign: 'center', padding: '24px 16px' }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 20,
                margin: '0 auto 14px',
                display: 'grid',
                placeItems: 'center',
                background: !syncState.online
                  ? 'var(--pending-bg)'
                  : ops.length
                    ? 'var(--info-bg)'
                    : 'var(--ok-bg)',
                color: !syncState.online
                  ? 'var(--pending)'
                  : ops.length
                    ? 'var(--info)'
                    : 'var(--ok)',
              }}
            >
              {!syncState.online ? (
                <IconCloudOff size="lg" />
              ) : syncState.syncing ? (
                <IconSync size="lg" className="spin" />
              ) : ops.length ? (
                <IconSync size="lg" />
              ) : (
                <IconCloudCheck size="lg" />
              )}
            </div>

            <div style={{ fontSize: 17, fontWeight: 650 }}>
              {!syncState.online
                ? t('offline')
                : syncState.syncing
                  ? t('syncing')
                  : waiting.length
                    ? t('queued_n', { n: waiting.length })
                    : t('synced')}
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5 }}>
              {syncState.lastSyncAt
                ? t('last_synced', { when: fmtWhen(syncState.lastSyncAt) })
                : t('nothing_queued_hint')}
            </div>

            {syncState.lastError && syncState.online ? (
              <Note kind="err" icon={<IconAlert />} style={{ marginTop: 14, textAlign: 'left' }}>
                {syncState.lastError}
              </Note>
            ) : null}

            <button
              className="btn primary"
              style={{ marginTop: 18 }}
              onClick={flushNow}
              disabled={syncState.syncing || !ops.length}
            >
              <IconRefresh />
              <span>{t('sync_now')}</span>
            </button>
          </div>

          {/* ----------------------------------------------------- queued */}
          {waiting.length ? (
            <>
              <SectionHead icon={<IconSync />} title={t('sync_queue')} value={String(waiting.length)} />
              <div className="card flush">
                {waiting.map((op) => (
                  <OpRow key={op.id} op={op} t={t} />
                ))}
              </div>
            </>
          ) : null}

          {/* ----------------------------------------------------- failed */}
          {failed.length ? (
            <>
              <SectionHead icon={<IconAlert />} title={t('needs_attention')} value={String(failed.length)} />
              <div className="card flush">
                {failed.map((op) => (
                  <OpRow
                    key={op.id}
                    op={op}
                    t={t}
                    onRetry={async () => {
                      await sync.retry(op.id);
                      toast.info(t('retry'));
                    }}
                    onDiscard={() => setDiscarding(op.id)}
                  />
                ))}
              </div>
            </>
          ) : null}

          {!ops.length ? (
            <EmptyState
              icon={<IconCheck />}
              title={t('nothing_queued')}
              body={t('nothing_queued_hint')}
            />
          ) : null}
        </div>
      </div>

      <Confirm
        open={!!discarding}
        title={t('discard_confirm')}
        confirmLabel={t('discard')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={async () => {
          if (discarding) await sync.discard(discarding);
          setDiscarding(null);
        }}
        onCancel={() => setDiscarding(null)}
      />
    </>
  );
}

function OpRow({
  op,
  t,
  onRetry,
  onDiscard,
}: {
  op: OutboxOp;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onRetry?: () => void;
  onDiscard?: () => void;
}) {
  const title = t(`op_${op.kind}`);
  const target =
    op.kind === 'save_card'
      ? [op.payload?.village_name, op.payload?.zone_name].filter(Boolean).join(' · ') ||
        op.payload?.townproject ||
        ''
      : (op.pourCard ?? '');

  return (
    <div style={{ padding: '13px 14px', borderBottom: '1px solid var(--hairline)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--text-muted)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {target ? `${target} · ` : ''}
            {fmtWhen(op.createdAt)}
            {op.attempts ? ` · ${t('attempts_n', { n: op.attempts })}` : ''}
          </div>
        </div>
        <span className={`status ${op.permanent ? 'cancelled' : 'pending'}`}>
          <span className="dot" />
          {op.permanent ? t('needs_attention') : t('pending_sync')}
        </span>
      </div>

      {op.lastError ? (
        <Note kind="err" icon={<IconAlert />} style={{ marginTop: 10 }}>
          {op.lastError}
        </Note>
      ) : null}

      {onRetry || onDiscard ? (
        <div className="btn-row" style={{ marginTop: 10 }}>
          {onRetry ? (
            <button className="btn secondary sm" onClick={onRetry}>
              <IconRefresh size="sm" />
              {t('retry')}
            </button>
          ) : null}
          {onDiscard ? (
            <button className="btn ghost sm" onClick={onDiscard} style={{ color: 'var(--err)' }}>
              <IconTrash size="sm" />
              {t('discard')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
