// Shapes returned by pipe_laying_inhouse.mobile_api.*
// Field names mirror the live Frappe doctypes exactly — see mobile_api.py.

export type DocStatus = 0 | 1 | 2; // Draft | Submitted | Cancelled

export interface Named {
  name: string;
}

export interface ProjectScoped extends Named {
  project?: string | null;
}

export interface Village extends ProjectScoped {
  zone?: string | null;
}

export interface Contractor extends ProjectScoped {
  contractor?: string | null;
}

export interface ItemRef extends Named {
  item_name?: string | null;
  item_group?: string | null;
  stock_uom?: string | null;
}

export interface Masters {
  rev: string;
  fetched_at: string;
  projects: Named[];
  zones: ProjectScoped[];
  villages: Village[];
  components: ProjectScoped[];
  contractors: Contractor[];
  pipe_items: ItemRef[];
  acc_items: ItemRef[];
  companies: { name: string; abbr: string }[];
}

export interface Capabilities {
  user: string;
  full_name: string;
  roles: string[];
  read: boolean;
  create: boolean;
  write: boolean;
  submit: boolean;
  cancel: boolean;
  default_company: string | null;
}

/** Every capability false — what the UI assumes until the real flags arrive. */
export const DENY_ALL: Capabilities = {
  user: '',
  full_name: '',
  roles: [],
  read: false,
  create: false,
  write: false,
  submit: false,
  cancel: false,
  default_company: null,
};

export interface CardSummary {
  name: string;
  project: string | null;
  zone: string | null;
  village: string | null;
  component: string | null;
  contractor: string | null;
  from_junction: string | null;
  to_junction: string | null;
  docstatus: DocStatus;
  material_issue: string | null;
  total_quantity: number;
  modified: string;
  owner: string;
  /** Set locally on cards that exist only in the outbox so far. */
  pending?: boolean;
  /** Count of queued laying batches not yet on the server. */
  pendingBatches?: number;
}

export interface ChildRow {
  idx: number;
  pipe_id: string | null;
  [key: string]: unknown;
}

export interface CardDetail {
  name: string;
  docstatus: DocStatus;
  project: string | null;
  zone: string | null;
  village: string | null;
  component: string | null;
  contractor: string | null;
  from_junction: string | null;
  to_junction: string | null;
  chainage_from: string | null;
  chainage_to: string | null;
  company: string | null;
  material_issue: string | null;
  total_quantity: number;
  excavation_qty_cum: number;
  attachment: string | null;
  owner: string;
  modified: string;
  can_write: boolean;
  can_submit: boolean;
  pipe: ChildRow[];
  soft: ChildRow[];
  hard: ChildRow[];
  murum: ChildRow[];
  cc: ChildRow[];
  soil: ChildRow[];
  acc: ChildRow[];
  backfill: ChildRow[];
}

export interface HomeSummary {
  total: number;
  draft: number;
  submitted: number;
  cancelled: number;
  recent: CardSummary[];
}

/** The New Card form. Field names match the Pour Card doctype. */
export interface CardHeader {
  townproject: string | null;
  zone_name: string | null;
  village_name: string | null;
  component: string | null;
  select_contractor: string | null;
  from_junction: string;
  to_junction: string;
  custom_chainage_from: string;
  custom_chainage_to: string;
}

/** The Add Laying Details form — one "batch" writing across 7 child tables. */
export interface LayingValues {
  date: string;
  select_contractor: string | null;

  pipe_length: number;
  pipe_width: number;
  pipe_depth: number;

  cc_length: number;
  cc_width: number;
  cc_depth: number;

  soft_length: number;
  soft_width: number;
  soft_depth: number;

  hard_length: number;
  hard_width: number;
  hard_depth: number;

  pipe_details: string | null;
  bedding_depth: number;
  strata_name: string | null;

  include_murum: 0 | 1;
  murum_length: number;
  murum_width: number;
  murum_depth: number;

  accessories: string | null;
  accessories_qty: number;
  remark: string;
}

export interface LayingTotals {
  pipe_calculated_qty: number;
  pipe_volume: number;
  hard_qty: number;
  soft_qty: number;
  cc_qty: number;
  murum_qty: number;
  soil_excavation_qty: number;
  total_excavation: number;
}

export interface BackfillRow {
  idx: number;
  pipe_id: string | null;
  date: string;
  pipe_details: string | null;
  diameter_mm: number;
  length: number;
  width: number;
  depth: number;
  bedding_depth: number;
  total_excavation: number;
  murum_qty: number;
  pipe_volume: number;
  backfilling_qty: number;
}

export interface BackfillResult {
  rows: BackfillRow[];
  totals: {
    total_excavation: number;
    murum_qty: number;
    pipe_volume: number;
    backfilling_qty: number;
  };
  saved: boolean;
}

// ------------------------------------------------------------------ outbox

export type OpKind = 'save_card' | 'add_laying_batch' | 'submit_card';

export type OpStatus = 'queued' | 'sending' | 'failed';

export interface OutboxOp {
  id: string;
  kind: OpKind;
  status: OpStatus;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Set when the server rejected this permanently — retrying won't help. */
  permanent?: boolean;

  /** save_card */
  payload?: CardHeader & { name?: string; company?: string | null };
  /** The client-side id this op creates, so later ops can reference it before
   *  the server has assigned a real Pour Card name. */
  localName?: string;

  /** add_laying_batch / submit_card — a real name, or a localName to resolve. */
  pourCard?: string;
  values?: LayingValues;
  batchUid?: string;
}

export interface SyncState {
  online: boolean;
  syncing: boolean;
  queued: number;
  failed: number;
  lastSyncAt: number | null;
  lastError: string | null;
}
