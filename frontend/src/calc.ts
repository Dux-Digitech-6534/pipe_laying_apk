// Client-side mirror of the Pour Card calculations.
//
// These exist so the numbers update as the user types — including with no
// signal, where a server round trip isn't an option. The SERVER recomputes all
// of them on write (see derive_laying_totals in mobile_api.py), so these are for
// feedback only and can never be the reason a wrong figure gets stored.
//
// Formulas are taken from the live desk client scripts, unchanged:
//   "Pour Card Details Popup (jewipl)"  -> laying batch
//   "Pour Card Backfilling Button"      -> backfilling

import type { LayingTotals, LayingValues } from './types';

/** L x W x D, but 0 unless all three are set — matches pcd_calc_qty, so a
 *  half-filled section reads as 0 rather than a misleading partial figure. */
export function calcQty(length: number, width: number, depth: number): number {
  const l = num(length);
  const w = num(width);
  const d = num(depth);
  if (!l || !w || !d) return 0;
  return l * w * d;
}

export function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Diameter in mm read out of an item name like "200mm HDPE".
 *  Prefers a number followed by "mm", else the first number present. */
export function extractDiameterMm(pipeDetails: string | null | undefined): number {
  if (!pipeDetails) return 0;
  const text = String(pipeDetails);

  const mm = text.match(/(\d+(\.\d+)?)\s*mm/i);
  if (mm) return num(mm[1]);

  const any = text.match(/(\d+(\.\d+)?)/);
  if (any) return num(any[1]);

  return 0;
}

/** (3.14 x d² / 4) x L, with d in metres. The 3.14 is deliberate — it is what
 *  the desk script uses, and the app must agree with it to the last decimal. */
export function calcPipeVolume(pipeDetails: string | null | undefined, pipeLength: number): number {
  const dM = extractDiameterMm(pipeDetails) / 1000;
  return ((3.14 * dM * dM) / 4) * num(pipeLength);
}

/** Everything derived from one laying batch. Mirrors derive_laying_totals(). */
export function deriveLayingTotals(v: Partial<LayingValues>): LayingTotals {
  const pipeCalculatedQty = calcQty(num(v.pipe_length), num(v.pipe_width), num(v.pipe_depth));
  const pipeVolume = calcPipeVolume(v.pipe_details, num(v.pipe_length));

  const hardQty = calcQty(num(v.hard_length), num(v.hard_width), num(v.hard_depth));
  const softQty = calcQty(num(v.soft_length), num(v.soft_width), num(v.soft_depth));
  const ccQty = calcQty(num(v.cc_length), num(v.cc_width), num(v.cc_depth));

  const murumQty = v.include_murum
    ? calcQty(num(v.murum_length), num(v.murum_width), num(v.murum_depth))
    : 0;

  return {
    pipe_calculated_qty: pipeCalculatedQty,
    pipe_volume: pipeVolume,
    hard_qty: hardQty,
    soft_qty: softQty,
    cc_qty: ccQty,
    murum_qty: murumQty,
    soil_excavation_qty: pipeCalculatedQty - ccQty - softQty - hardQty,
    total_excavation: softQty + hardQty + ccQty,
  };
}

export interface LengthProblem {
  field: keyof LayingValues;
  label: string;
  value: number;
  limit: number;
}

/** No excavation stretch may be longer than the pipe run itself.
 *
 *  The desk popup zeroes the offending field on the spot; here the value is left
 *  alone and flagged instead, so the user can see what they typed and correct
 *  it — losing a number silently is worse on a phone in the field. */
export function findLengthProblems(v: Partial<LayingValues>): LengthProblem[] {
  const limit = num(v.pipe_length);
  if (!limit) return [];

  const checks: { field: keyof LayingValues; label: string }[] = [
    { field: 'hard_length', label: 'Hard Rock' },
    { field: 'soft_length', label: 'Soft Rock' },
    { field: 'cc_length', label: 'CC Road Breaking' },
    { field: 'murum_length', label: 'Murum' },
  ];

  const problems: LengthProblem[] = [];
  for (const check of checks) {
    if (check.field === 'murum_length' && !v.include_murum) continue;
    const value = num(v[check.field]);
    if (value && value > limit) {
      problems.push({ field: check.field, label: check.label, value, limit });
    }
  }
  return problems;
}

/** Backfilling for one pipe row.
 *
 *  Mirrors pcbf_calculate_backfilling_rows, except for Murum. The desk script
 *  derives that from the pipe row's bedding depth, which nothing on this site
 *  ever writes — so Murum came out 0 on every card even when the operator had
 *  entered Murum L/W/D. The caller passes the quantity actually recorded in the
 *  Murum Details rows instead. Same substitution server-side in
 *  mobile_api._murum_for_pipe, so an online recalculation agrees with this. */
export function calcBackfillRow(row: {
  pipe_details?: string | null;
  length: number;
  width: number;
  depth: number;
  murum_qty: number;
}) {
  const diameterMm = extractDiameterMm(row.pipe_details);
  const diameterM = diameterMm / 1000;

  const totalExcavation = num(row.length) * num(row.width) * num(row.depth);
  const murumQty = num(row.murum_qty);
  const pipeVolume = ((3.14 * diameterM * diameterM) / 4) * num(row.length);

  return {
    diameter_mm: diameterMm,
    total_excavation: totalExcavation,
    murum_qty: murumQty,
    pipe_volume: pipeVolume,
    backfilling_qty: totalExcavation - murumQty - pipeVolume,
  };
}

// ------------------------------------------------------------------ display

/** Fixed decimals with no thousands separator — these are engineering
 *  quantities in cubic metres, and a comma reads as a decimal point to some
 *  users here. */
export function fmt(value: number, precision = 3): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(precision);
}

/** Trim trailing zeros so 2.500 shows as 2.5 but 2.503 keeps its precision. */
export function fmtTrim(value: number, precision = 3): string {
  if (!Number.isFinite(value)) return '0';
  const text = value.toFixed(precision);
  return text.replace(/\.?0+$/, '') || '0';
}

export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

/** dd-mm-yyyy — the format the desk shows and users here expect. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length !== 3) return String(iso);
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

export function fmtWhen(value: string | number | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;

  return fmtDate(date.toISOString());
}
