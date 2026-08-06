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
  LayingValues,
  Masters,
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
    readonly kind: 'network' | 'auth' | 'permission' | 'validation' | 'server',
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
        throw new ApiError('Your session has expired. Please sign in again.', 'auth', response.status);
      }
      body = null;
    }
  }

  if (!response.ok) throw classify(response.status, body);

  return (body as { message?: T })?.message as T;
}

// -------------------------------------------------------------- reads

export const fetchCapabilities = () => call<Capabilities>(API.capabilities);
export const fetchMasters = () => call<Masters>(API.masters, {}, { timeoutMs: 45000 });
export const fetchHomeSummary = () => call<HomeSummary>(API.homeSummary);

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
 * Sign in against Frappe from inside the app — no redirect to the unbranded
 * /login page. A Guest POST to /api/method/login needs no CSRF token (Frappe
 * exempts Guests), and on success Frappe sets the session cookie; the caller
 * then reloads so the static shell re-injects the authenticated CSRF token.
 */
export async function login(usr: string, pwd: string): Promise<void> {
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

  // Bad credentials come back as 401; surface a clean message rather than
  // Frappe's HTML.
  if (response.status === 401) {
    throw new ApiError('Invalid email or password', 'auth', 401);
  }

  let body: unknown = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* HTML or plain text — classify() falls back to a status message */
    }
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
