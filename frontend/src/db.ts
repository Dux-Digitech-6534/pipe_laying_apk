// IndexedDB persistence — the app's offline memory.
//
// Three concerns:
//   kv      cached server reads (masters, capabilities, card list, card details)
//   outbox  writes made offline, waiting to reach the server
//   meta    small bookkeeping (last sync time, id counter)
//
// A hand-rolled promise wrapper rather than a library: the surface we need is
// six calls wide, and this keeps the bundle small enough to load on a weak
// site connection.

import type { OutboxOp } from './types';

const DB_NAME = 'plm';
const DB_VERSION = 1;

const STORE_KV = 'kv';
const STORE_OUTBOX = 'outbox';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const store = db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** IndexedDB can be unavailable (private mode, locked-down WebView). Callers
 *  degrade to online-only rather than crashing. */
export const storageAvailable = (() => {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------- kv

export async function kvGet<T>(key: string): Promise<T | null> {
  if (!storageAvailable) return null;
  try {
    const value = await tx<T | undefined>(STORE_KV, 'readonly', (s) => s.get(key));
    return value ?? null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  if (!storageAvailable) return;
  try {
    await tx(STORE_KV, 'readwrite', (s) => s.put(value, key));
  } catch {
    /* a full or unavailable store must never break the UI */
  }
}

export async function kvDelete(key: string): Promise<void> {
  if (!storageAvailable) return;
  try {
    await tx(STORE_KV, 'readwrite', (s) => s.delete(key));
  } catch {
    /* ignore */
  }
}

export async function kvClear(): Promise<void> {
  if (!storageAvailable) return;
  try {
    await tx(STORE_KV, 'readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ outbox

export async function outboxAll(): Promise<OutboxOp[]> {
  if (!storageAvailable) return [];
  try {
    const all = await tx<OutboxOp[]>(STORE_OUTBOX, 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function outboxPut(op: OutboxOp): Promise<void> {
  if (!storageAvailable) return;
  await tx(STORE_OUTBOX, 'readwrite', (s) => s.put(op));
}

export async function outboxDelete(id: string): Promise<void> {
  if (!storageAvailable) return;
  try {
    await tx(STORE_OUTBOX, 'readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}

export async function outboxClear(): Promise<void> {
  if (!storageAvailable) return;
  try {
    await tx(STORE_OUTBOX, 'readwrite', (s) => s.clear());
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------------- ids

/** Collision-resistant id for outbox ops and idempotency keys.
 *
 *  Doubles as the server-side batch uid, so it must stay unique across devices
 *  and across reinstalls — hence randomness plus a timestamp, not a counter. */
export function newId(prefix = 'op'): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/** Placeholder name for a card that only exists offline. Rendered to the user
 *  as "NEW-…" so it's obvious the real PC-xxxxx number comes from the server. */
export function newLocalCardName(): string {
  return newId('NEW');
}

export function isLocalName(name: string | null | undefined): boolean {
  return !!name && name.startsWith('NEW-');
}
