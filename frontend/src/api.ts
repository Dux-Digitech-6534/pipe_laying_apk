// The single source of truth for backend method names, plus the transport.
//
// Everything goes through Frappe's /api/method endpoint with the session cookie
// and the CSRF token the host page injected. No SDK: the offline queue needs to
// own retry and error classification itself.

import type {
  BackfillResult,
  CardDetail,
  CardHeader,
  CardSummary,
  Capabilities,
  HomeSummary,
  ItemHit,
  LayingValues,
  Masters,
  MtMasters,
  MtPayload,
  OutboxOp,
} from './types';

const PREFIX = 'pipe_laying_inhouse.mobile_api.';

export const API = {
  ping: PREFIX + 'ping',
  capabilities: PREFIX + 'capabilities',
  masters: PREFIX + 'get_masters',
  listCards: PREFIX + 'list_cards',
  homeSummary: PREFIX + 'home_summary',
  getCard: PREFIX + 'get_card',
  saveCard: PREFIX + 'save_card',
  addLayingBatch: PREFIX + 'add_laying_batch',
  submitCard: PREFIX + 'submit_card',
  calcBackfilling: PREFIX + 'calc_backfilling',
  checkDuplicate: PREFIX + 'check_duplicate',
  syncBatch: PREFIX + 'sync_batch',
  mtMasters: PREFIX + 'mt_masters',
  itemSearch: PREFIX + 'item_search',
  // Material Transfer builds a real Stock Entry, so it reuses the desk-side
  // helpers in api.py rather than duplicating the doc-building logic.
  saveMaterialTransfer: 'pipe_laying_inhouse.api.save_material_transfer',
  submitMaterialTransfer: 'pipe_laying_inhouse.api.submit_material_transfer',
  logout: 'logout',
} as const;

export interface BootInfo {
  csrf_token: string;
  user: string;
  full_name: string;
  site: string;
  build: string | number;
}

declare global {
  interface Window {
    PLM_BOOT?: BootInfo;
    csrf_token?: string;
  }
}

export const boot: BootInfo =
  window.PLM_BOOT ?? {
    csrf_token: window.csrf_token ?? '',
    user: 'Guest',
    full_name: 'Guest',
    site: location.host,
    build: 'dev',
  };

/** An error we can reason about: was it the network, the session, or the data? */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'auth' | 'permission' | 'validation' | 'server' | 'locked',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Worth queueing and retrying later, vs. needs the user to change something. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'server';
  }
}

// A session can die at any moment, not just during boot, and the screen that
// notices is usually not the one that can do anything about it. Frappe answers
// a signed-out caller with "You are not permitted to access this resource.
// Login to access Function <x> is not whitelisted." — true, useless to a user
// on a trench, and it was being printed verbatim. Announce the loss centrally
// instead and let the shell offer a sign-in.
const AUTH_LOST_EVENT = 'plm:auth-lost';

export function onAuthLost(handler: () => void): () => void {
  window.addEventListener(AUTH_LOST_EVENT, handler);
  return () => window.removeEventListener(AUTH_LOST_EVENT, handler);
}

/** Throw, announcing first if the session is what failed. */
function raise(error: ApiError): never {
  if (error.kind === 'auth') window.dispatchEvent(new Event(AUTH_LOST_EVENT));
  throw error;
}

/** Frappe wraps thrown messages in HTML and JSON-in-a-string. Dig out something
 *  a field user can act on. */
function readableError(body: unknown, fallback: string): string {
  const record = body as Record<string, unknown> | null;
  if (!record) return fallback;

  const candidates: string[] = [];

  const messages = record._server_messages;
  if (typeof messages === 'string') {
    try {
      for (const raw of JSON.parse(messages) as string[]) {
        try {
          const parsed = JSON.parse(raw) as { message?: string; title?: string };
          if (parsed.message) candidates.push(parsed.message);
        } catch {
          candidates.push(raw);
        }
      }
    } catch {
      /* leave it */
    }
  }

  if (typeof record.exception === 'string' && record.exception) {
    candidates.push(record.exception.replace(/^[\w.]*Error:\s*/, ''));
  }
  if (typeof record.message === 'string' && record.message) {
    candidates.push(record.message);
  }

  const text = candidates.find((c) => c && c.trim());
  if (!text) return fallback;

  // Strip Frappe's markup and its "click here to see the doc" links.
  return text
    .replace(/<a[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function classify(status: number, body: unknown): ApiError {
  const message = readableError(body, `Request failed (${status})`);

  if (status === 401 || status === 403) {
    const looksLikeAuth = /log\s?in|session|expired|not permitted/i.test(message);
    return new ApiError(message, looksLikeAuth ? 'auth' : 'permission', status);
  }
  if (status === 417 || status === 400) return new ApiError(message, 'validation', status);
  if (status >= 500) return new ApiError(message, 'server', status);
  return new ApiError(message, 'server', status);
}

/**
 * Call a whitelisted Frappe method.
 *
 * GET for reads (cacheable, safe to repeat), POST for writes. The CSRF token
 * goes on every POST; a stale one after a server restart surfaces as an auth
 * error, and a reload refreshes it.
 */
export async function call<T>(
  method: string,
  args: Record<string, unknown> = {},
  options: { post?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const post = options.post ?? false;
  const timeoutMs = options.timeoutMs ?? 30000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let url = `/api/method/${method}`;
  const init: RequestInit = {
    method: post ? 'POST' : 'GET',
    credentials: 'same-origin',
    signal: controller.signal,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  };

  if (post) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    (init.headers as Record<string, string>)['X-Frappe-CSRF-Token'] = boot.csrf_token;
    init.body = JSON.stringify(args);
  } else {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;
      params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const query = params.toString();
    if (query) url += `?${query}`;
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    throw new ApiError(
      aborted ? 'Request timed out' : 'No connection',
      'network',
    );
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // An HTML body from a Frappe method almost always means the session died
      // and we were handed the login page.
      if (/<html/i.test(text)) {
        raise(new ApiError('Your session has expired. Please sign in again.', 'auth', response.status));
      }
      body = null;
    }
  }

  if (!response.ok) raise(classify(response.status, body));

  return (body as { message?: T })?.message as T;
}

// -------------------------------------------------------------- reads

export const fetchCapabilities = () => call<Capabilities>(API.capabilities);
export const fetchMasters = () => call<Masters>(API.masters, {}, { timeoutMs: 45000 });
export const fetchHomeSummary = () => call<HomeSummary>(API.homeSummary);

export const fetchMtMasters = () => call<MtMasters>(API.mtMasters, {}, { timeoutMs: 30000 });

/** Item lookup for the transfer picker. Searched server-side — the item list is
 *  far too large to cache on the phone. */
export const searchItems = (q: string) => call<ItemHit[]>(API.itemSearch, { q, limit: 25 });

export const fetchCards = (args: {
  search?: string;
  status?: string;
  project?: string;
  limit?: number;
}) => call<CardSummary[]>(API.listCards, args);

export const fetchCard = (name: string) => call<CardDetail>(API.getCard, { name });

export const fetchBackfilling = (pourCard: string, rows?: string[], date?: string) =>
  call<BackfillResult>(API.calcBackfilling, {
    pour_card: pourCard,
    rows: rows ? JSON.stringify(rows) : undefined,
    date,
  });

export const checkDuplicate = (payload: CardHeader & { name?: string }) =>
  call<{ duplicate: string | null; same_junction: boolean }>(API.checkDuplicate, {
    payload: JSON.stringify(payload),
  });

export const pingServer = () => call<{ ok: boolean; user: string }>(API.ping, {}, { timeoutMs: 8000 });

// -------------------------------------------------------------- writes

export interface SaveCardResult {
  name: string;
  docstatus: 0 | 1 | 2;
  created: boolean;
  deduped?: boolean;
  locked?: boolean;
}

export const saveCard = (payload: CardHeader & { name?: string; company?: string | null }) =>
  call<SaveCardResult>(API.saveCard, { payload: JSON.stringify(payload) }, { post: true });

export interface AddBatchResult {
  name: string;
  docstatus: 0 | 1 | 2;
  pipe_id: string | null;
  skipped?: boolean;
  total_quantity?: number;
}

export const addLayingBatch = (pourCard: string, values: LayingValues, batchUid: string) =>
  call<AddBatchResult>(
    API.addLayingBatch,
    { pour_card: pourCard, values: JSON.stringify(values), batch_uid: batchUid },
    { post: true },
  );

export const submitCard = (name: string) =>
  call<{ name: string; docstatus: 0 | 1 | 2; material_issue: string | null }>(
    API.submitCard,
    { name },
    { post: true, timeoutMs: 60000 },
  );

export interface MtResult {
  name: string;
  docstatus: 0 | 1 | 2;
  skipped?: boolean;
}

/** Two-step like the desk form: this only inserts/updates a draft. Submitting
 *  is a separate call, so ERPNext's stock validation runs where the user can
 *  still see and fix the entry. */
export const saveMaterialTransfer = (payload: MtPayload) =>
  call<MtResult>(
    API.saveMaterialTransfer,
    {
      company: payload.company,
      posting_date: payload.posting_date,
      from_warehouse: payload.from_warehouse,
      to_warehouse: payload.to_warehouse,
      items: JSON.stringify(payload.items),
      name: payload.name ?? undefined,
    },
    { post: true, timeoutMs: 60000 },
  );

export const submitMaterialTransfer = (name: string) =>
  call<MtResult>(API.submitMaterialTransfer, { name }, { post: true, timeoutMs: 60000 });

export const saveBackfilling = (pourCard: string, rows: string[], date: string) =>
  call<BackfillResult>(
    API.calcBackfilling,
    { pour_card: pourCard, rows: JSON.stringify(rows), date, save: 1 },
    { post: true },
  );

// -------------------------------------------------------------- batch replay

export interface SyncOpResult {
  id: string;
  kind: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  permanent?: boolean;
}

/** Replay queued ops server-side in one round trip. Shaped to match what
 *  sync_batch expects; see mobile_api.sync_batch. */
export const syncOutbox = (ops: OutboxOp[]) =>
  call<{
    results: SyncOpResult[];
    /** placeholder card name -> the real PC-xxxxx the server assigned */
    resolved: Record<string, string>;
    server_time: string;
  }>(
    API.syncBatch,
    {
      ops: JSON.stringify(
        ops.map((op) => ({
          id: op.id,
          kind: op.kind,
          payload: op.payload,
          local_name: op.localName,
          pour_card: op.pourCard,
          values: op.values,
          batch_uid: op.batchUid ?? op.id,
        })),
      ),
    },
    { post: true, timeoutMs: 120000 },
  );

/**
 * Sign in against Frappe's own /api/method/login.
 *
 * Not routed through call(): that helper posts JSON with a CSRF token, and the
 * login endpoint wants form encoding and has no token to send yet. On success
 * Frappe sets the session cookie, which is all the rest of the app needs — the
 * password is never stored, only forwarded same-origin.
 */
export async function signIn(usr: string, pwd: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let response: Response;
  try {
    response = await fetch('/api/method/login', {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ usr, pwd }).toString(),
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    throw new ApiError(aborted ? 'Request timed out' : 'No connection', 'network');
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return;

  let body: unknown = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON — classify() falls back to a generic message */
    }
  }

  // After allow_consecutive_login_attempts failures Frappe locks the account
  // (and the IP) for allow_login_after_fail seconds and throws SecurityException
  // — a bare Exception with no http_status_code, so it arrives as a 500. Telling
  // that user "invalid password" is what produces the retry storm that keeps the
  // lock alive; they need to know to stop and wait. exc_type is matched rather
  // than the message text, which is translated.
  if ((body as { exc_type?: string } | null)?.exc_type === 'SecurityException') {
    throw new ApiError(
      readableError(body, 'Too many attempts. Please wait a minute.'),
      'locked',
      response.status,
    );
  }

  // Frappe answers a bad credential pair with 401, so classify it directly
  // rather than letting readableError guess from the HTML body it returns.
  if (response.status === 401) {
    throw new ApiError('Invalid email or password', 'auth', 401);
  }

  throw classify(response.status, body);
}

export async function logout(): Promise<void> {
  try {
    await call(API.logout, {}, { post: true, timeoutMs: 10000 });
  } catch {
    /* even a failed logout should drop the user to the login page */
  }
}
