// The offline engine.
//
// Writes never hit the network directly. They go into an IndexedDB outbox and
// the app renders them immediately as pending. This module drains that outbox
// whenever a connection is actually usable, and tells the UI what it's doing.
//
// Why not just trust navigator.onLine: on Android it reports "online" for a
// radio that can't reach anything (captive portal, site with no backhaul, a
// tower that's associated but dead). The only honest test is a real request, so
// reachability is confirmed with a cheap ping before a flush and after any
// network failure.

import {
  ApiError,
  fetchCapabilities,
  fetchCards,
  fetchMasters,
  pingServer,
  syncOutbox,
} from './api';
import { isLocalName, kvGet, kvSet, newId, outboxAll, outboxDelete, outboxPut } from './db';
import type { CardHeader, CardSummary, LayingValues, Masters, OutboxOp, SyncState } from './types';

export const KEY_MASTERS = 'masters';
export const KEY_CAPS = 'capabilities';
export const KEY_CARDS = 'cards';
export const KEY_LAST_SYNC = 'lastSyncAt';
/** Placeholder card name -> the real PC-xxxxx the server assigned.
 *
 *  Kept durably because the user may still be sitting on a screen addressed by
 *  the placeholder when the sync lands. Without this the route points at a name
 *  that no longer exists anywhere and the screen has nothing to render. */
export const KEY_RESOLVED = 'resolvedNames';
export const cardKey = (name: string) => `card:${name}`;

/** Look up what a placeholder card name became, if it has synced. */
export async function resolveLocalName(local: string): Promise<string | null> {
  const map = (await kvGet<Record<string, string>>(KEY_RESOLVED)) ?? {};
  return map[local] ?? null;
}

// Retry backoff for transient failures, in ms. Capped so a phone that regains
// signal after a long shift still syncs promptly.
const BACKOFF = [0, 5_000, 15_000, 60_000, 300_000];

type Listener = (state: SyncState) => void;

class SyncEngine {
  private listeners = new Set<Listener>();
  private state: SyncState = {
    online: navigator.onLine,
    syncing: false,
    queued: 0,
    failed: 0,
    lastSyncAt: null,
    lastError: null,
  };

  /** Set once a flush has been asked for while one was already running. */
  private rerun = false;
  private nextAttemptAt = 0;
  private timer: number | null = null;

  // ------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    await this.refreshCounts();
    this.state.lastSyncAt = (await kvGet<number>(KEY_LAST_SYNC)) ?? null;
    this.emit();

    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);

    // A heartbeat catches the cases the events miss: a WebView resumed from the
    // background, or a connection that came back without firing 'online'.
    this.timer = window.setInterval(() => {
      void this.flush();
    }, 30_000);

    void this.flush();
  }

  stop(): void {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  private onOnline = () => {
    this.patch({ online: true });
    // Give the interface a moment to actually attach before the first request.
    window.setTimeout(() => void this.flush(true), 800);
  };

  private onOffline = () => this.patch({ online: false });

  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.flush();
  };

  // ------------------------------------------------------------ observers

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return this.state;
  }

  private emit(): void {
    const snapshot = { ...this.state };
    for (const listener of this.listeners) listener(snapshot);
  }

  private patch(next: Partial<SyncState>): void {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  private async refreshCounts(): Promise<void> {
    const ops = await outboxAll();
    this.state.queued = ops.filter((op) => !op.permanent).length;
    this.state.failed = ops.filter((op) => op.permanent).length;
  }

  // ------------------------------------------------------------- enqueueing

  /** Queue a header save. Returns the card name the UI should navigate to —
   *  either the real one or a "NEW-…" placeholder the engine will swap out. */
  async queueSaveCard(
    header: CardHeader,
    options: { name?: string; company?: string | null } = {},
  ): Promise<{ opId: string; cardName: string }> {
    const cardName = options.name ?? `NEW-${newId('c').slice(3)}`;

    const op: OutboxOp = {
      id: newId('save'),
      kind: 'save_card',
      status: 'queued',
      createdAt: Date.now(),
      attempts: 0,
      localName: cardName,
      payload: {
        ...header,
        name: isLocalName(cardName) ? undefined : cardName,
        company: options.company ?? null,
      },
    };

    await outboxPut(op);
    await this.refreshCounts();
    this.emit();
    void this.flush();

    return { opId: op.id, cardName };
  }

  async queueLayingBatch(pourCard: string, values: LayingValues): Promise<string> {
    const op: OutboxOp = {
      id: newId('lay'),
      kind: 'add_laying_batch',
      status: 'queued',
      createdAt: Date.now(),
      attempts: 0,
      pourCard,
      values,
      // The idempotency key. Survives retries, reloads and reinstalls, so the
      // server can recognise a replay and refuse to write the batch twice.
      batchUid: newId('batch'),
    };

    await outboxPut(op);
    await this.refreshCounts();
    this.emit();
    void this.flush();

    return op.id;
  }

  async queueSubmit(pourCard: string): Promise<string> {
    const op: OutboxOp = {
      id: newId('sub'),
      kind: 'submit_card',
      status: 'queued',
      createdAt: Date.now(),
      attempts: 0,
      pourCard,
    };

    await outboxPut(op);
    await this.refreshCounts();
    this.emit();
    void this.flush();

    return op.id;
  }

  /** Drop a permanently-failed op the user has acknowledged. */
  async discard(opId: string): Promise<void> {
    await outboxDelete(opId);
    await this.refreshCounts();
    this.emit();
  }

  /** Put a failed op back in the queue — for after the user fixed the cause
   *  (e.g. a master record that was missing has now been created). */
  async retry(opId: string): Promise<void> {
    const ops = await outboxAll();
    const op = ops.find((candidate) => candidate.id === opId);
    if (!op) return;

    await outboxPut({ ...op, permanent: false, status: 'queued', attempts: 0, lastError: undefined });
    await this.refreshCounts();
    this.emit();
    void this.flush();
  }

  async pending(): Promise<OutboxOp[]> {
    return outboxAll();
  }

  // ------------------------------------------------------------------ flush

  /** Drain the outbox. Safe to call often; it self-serialises and backs off. */
  async flush(force = false): Promise<void> {
    if (this.state.syncing) {
      this.rerun = true;
      return;
    }
    if (!force && Date.now() < this.nextAttemptAt) return;

    const ops = (await outboxAll()).filter((op) => !op.permanent);
    if (!ops.length) {
      await this.refreshCounts();
      this.emit();
      return;
    }

    this.patch({ syncing: true });

    try {
      // Confirm the connection is real before sending a payload that may hold
      // a whole shift's data.
      await pingServer();
      this.patch({ online: true });

      const { results, resolved } = await syncOutbox(ops);

      // Rewrite any cached references from placeholder to real card name, so the
      // list and detail screens stop showing "NEW-…" the moment sync lands.
      if (resolved && Object.keys(resolved).length) {
        await this.applyResolved(resolved);
      }

      let hadTransientFailure = false;

      for (const result of results) {
        const op = ops.find((candidate) => candidate.id === result.id);
        if (!op) continue;

        if (result.ok) {
          await outboxDelete(op.id);
          continue;
        }

        const attempts = op.attempts + 1;

        if (result.permanent) {
          // The server rejected the data itself. Retrying identical data will
          // fail identically — surface it and let the user decide.
          await outboxPut({
            ...op,
            status: 'failed',
            attempts,
            permanent: true,
            lastError: result.error ?? 'Rejected by server',
          });
        } else {
          hadTransientFailure = true;
          await outboxPut({
            ...op,
            status: 'queued',
            attempts,
            // Give up on silent retries eventually; keep the data, flag it.
            permanent: attempts >= 8,
            lastError: result.error ?? 'Failed',
          });
        }
      }

      await kvSet(KEY_LAST_SYNC, Date.now());
      this.patch({ lastSyncAt: Date.now(), lastError: null });
      this.nextAttemptAt = hadTransientFailure ? Date.now() + BACKOFF[1] : 0;

      // Server state moved; refresh the read caches so the UI agrees with it.
      await this.refreshCaches();
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const offline = apiError?.kind === 'network';

      this.patch({
        online: offline ? false : this.state.online,
        lastError: apiError?.message ?? 'Sync failed',
      });

      // Nothing was consumed — bump attempts so the backoff grows, but keep
      // every op queued.
      for (const op of ops) {
        const attempts = op.attempts + 1;
        await outboxPut({ ...op, attempts, status: 'queued', lastError: apiError?.message });
      }

      const worst = Math.min(
        ...ops.map((op) => Math.min(op.attempts, BACKOFF.length - 1)),
      );
      this.nextAttemptAt = Date.now() + BACKOFF[Math.max(1, worst)];
    } finally {
      await this.refreshCounts();
      this.patch({ syncing: false });

      if (this.rerun) {
        this.rerun = false;
        void this.flush();
      }
    }
  }

  /** Swap placeholder card names for real ones across the cached data. */
  private async applyResolved(resolved: Record<string, string>): Promise<void> {
    // Remember the mapping first: a screen currently addressed by a placeholder
    // needs it to redirect itself to the real card.
    const known = (await kvGet<Record<string, string>>(KEY_RESOLVED)) ?? {};
    await kvSet(KEY_RESOLVED, { ...known, ...resolved });

    const cards = (await kvGet<CardSummary[]>(KEY_CARDS)) ?? [];
    let changed = false;

    const next = cards.map((card) => {
      const real = resolved[card.name];
      if (!real) return card;
      changed = true;
      return { ...card, name: real, pending: false };
    });

    if (changed) await kvSet(KEY_CARDS, next);

    // Any queued op still pointing at a placeholder gets repointed, so a later
    // flush doesn't have to rely on the server-side map again.
    for (const op of await outboxAll()) {
      const real = op.pourCard ? resolved[op.pourCard] : undefined;
      if (real) await outboxPut({ ...op, pourCard: real });
    }
  }

  // ------------------------------------------------------------ read caches

  /** Pull masters + capabilities + the card list and cache them for offline use.
   *
   *  This is what makes backend changes show up in the app: masters come from the
   *  DB every refresh, so a Project, Zone, Village, Contractor, Component or Item
   *  added on the server appears here with no deploy and no new APK. */
  async refreshCaches(): Promise<void> {
    try {
      const [caps, cards] = await Promise.all([fetchCapabilities(), fetchCards({ limit: 200 })]);
      await kvSet(KEY_CAPS, caps);
      await kvSet(KEY_CARDS, cards);
    } catch {
      /* offline — the cached copies stay valid */
    }

    try {
      const cached = await kvGet<Masters>(KEY_MASTERS);
      const fresh = await fetchMasters();
      // rev folds in row counts and the newest modified timestamp of every
      // master doctype, so an unchanged rev means nothing to redraw.
      if (!cached || cached.rev !== fresh.rev) {
        await kvSet(KEY_MASTERS, fresh);
      }
    } catch {
      /* offline — keep what we have */
    }
  }

  /** True once we've confirmed the server is reachable right now. */
  async probe(): Promise<boolean> {
    try {
      await pingServer();
      this.patch({ online: true });
      return true;
    } catch {
      this.patch({ online: false });
      return false;
    }
  }
}

export const sync = new SyncEngine();
