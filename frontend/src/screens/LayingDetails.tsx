// Add Laying Details — the screen field staff live in.
//
// One submission writes a row into seven child tables, all sharing a generated
// Pipe ID, exactly as the live desk "Pour Card Details" popup does. Derived
// figures update as the user types, work with no signal, and are recomputed
// server-side on write so what gets stored can never drift from the formulas.
//
// Layout follows the prototype: a `.sec` block per material with the running
// quantity in the section header, dense `.mini` L/W/D triples, and `.ro`
// readouts for computed values.
//
// One deliberate difference from the prototype, matching the LIVE desk script
// rather than the mock: CC Road Breaking is always visible and MURUM is the
// section behind the toggle. The prototype had these the other way round; the
// backend's popup and its soil formula depend on this arrangement.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveLayingTotals,
  extractDiameterMm,
  findLengthProblems,
  fmt,
  num,
  todayISO,
} from '../calc';
import { ApiError, updateLayingBatch } from '../api';
import { sync } from '../sync';
import { useCascade, useStore } from '../store';
import { goBack } from '../router';
import { Picker } from '../components/Picker';
import { DateField, NumField, Readout, TextField, Toggle } from '../components/Fields';
import { Note, SectionHead, useToast } from '../components/Feedback';
import {
  IconAlert,
  IconBox,
  IconCalendar,
  IconCheck,
  IconCloudOff,
  IconDrop,
  IconHat,
  IconLayers,
  IconMountain,
  IconPlus,
  IconRoad,
  IconRuler,
} from '../icons';
import type { CardDetail, LayingValues } from '../types';

function emptyValues(contractor: string | null): LayingValues {
  return {
    date: todayISO(),
    select_contractor: contractor,

    pipe_length: 0,
    pipe_width: 0,
    pipe_depth: 0,

    cc_length: 0,
    cc_width: 0,
    cc_depth: 0,

    soft_length: 0,
    soft_width: 0,
    soft_depth: 0,

    hard_length: 0,
    hard_width: 0,
    hard_depth: 0,

    pipe_details: null,
    bedding_depth: 0,
    strata_name: null,

    include_murum: 0,
    murum_length: 0,
    murum_width: 0,
    murum_depth: 0,

    accessories: null,
    accessories_qty: 0,
    remark: '',
  };
}

/** Rebuild the form values for one existing entry (Pipe ID) from the card's
 *  child rows, so editing opens pre-filled. Returns null if the entry isn't on
 *  the card (e.g. it hasn't loaded yet). */
function valuesFromEntry(card: CardDetail, pipeId: string): LayingValues | null {
  const find = (rows: CardDetail['pipe']) => rows.find((row) => row.pipe_id === pipeId);
  const pipe = find(card.pipe);
  if (!pipe) return null;

  const cc = find(card.cc);
  const soft = find(card.soft);
  const hard = find(card.hard);
  const murum = find(card.murum);
  const acc = find(card.acc);

  return {
    date: String(pipe.date_of_pipelaying ?? todayISO()).slice(0, 10),
    select_contractor: card.contractor ?? null,

    pipe_length: num(pipe.length_of_pipemtr),
    pipe_width: num(pipe.width_of_pipemtr),
    pipe_depth: num(pipe.depth_of_pipemtr),

    cc_length: num(cc?.cc_road_badding_length),
    cc_width: num(cc?.cc_road_badding_width),
    cc_depth: num(cc?.cc_road_breaking_depth),

    soft_length: num(soft?.lengthmtr),
    soft_width: num(soft?.widthmtr),
    soft_depth: num(soft?.depthmtr),

    hard_length: num(hard?.hard_rock_lengthmtr),
    hard_width: num(hard?.hard_rock_widthmtr),
    hard_depth: num(hard?.hard_rock_depthmtr),

    pipe_details: (pipe.pipe_details as string) ?? null,
    bedding_depth: num(pipe.custom_bedding),
    strata_name: null,

    include_murum: murum ? 1 : 0,
    murum_length: num(murum?.hard_rock_lengthmtr),
    murum_width: num(murum?.hard_rock_widthmtr),
    murum_depth: num(murum?.hard_rock_depthmtr),

    accessories: (acc?.accessories as string) ?? null,
    accessories_qty: num(acc?.qauntity),
    remark: String(acc?.remark ?? ''),
  };
}

interface Props {
  card: CardDetail | null;
  cardName: string;
  /** When set, this screen edits the existing batch with this Pipe ID instead
   *  of adding a new one. Online-only. */
  editPipeId?: string;
  onAdded: () => void;
}

export function LayingDetails({ card, cardName, editPipeId, onAdded }: Props) {
  const editing = !!editPipeId;
  const { t, masters, syncState } = useStore();
  const cascade = useCascade(masters);
  const toast = useToast();

  const [values, setValues] = useState<LayingValues>(() =>
    emptyValues(card?.contractor ?? null),
  );
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  // The card is fetched after this screen mounts, so the contractor default
  // isn't available at first render. Adopt it when it lands — but only while the
  // field is still untouched, so we never overwrite a deliberate choice.
  const contractorTouched = useRef(false);
  useEffect(() => {
    if (editing) return; // edit mode hydrates the whole form below
    if (contractorTouched.current) return;
    if (!card?.contractor) return;
    setValues((current) =>
      current.select_contractor ? current : { ...current, select_contractor: card.contractor },
    );
  }, [card?.contractor, editing]);

  // Edit mode: the card loads after this screen mounts, so pre-fill from the
  // entry once it's available — but only once, so we never clobber user edits.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!editing || hydrated.current || !card || !editPipeId) return;
    const reconstructed = valuesFromEntry(card, editPipeId);
    if (reconstructed) {
      hydrated.current = true;
      setValues(reconstructed);
    }
  }, [card, editPipeId, editing]);

  const set = <K extends keyof LayingValues>(key: K, value: LayingValues[K]) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      // Turning Murum off zeroes its inputs, matching the desk popup — leaving
      // stale numbers would feed a quantity the user believes is excluded.
      if (key === 'include_murum' && !value) {
        next.murum_length = 0;
        next.murum_width = 0;
        next.murum_depth = 0;
      }
      return next;
    });
  };

  const totals = useMemo(() => deriveLayingTotals(values), [values]);
  const lengthProblems = useMemo(() => findLengthProblems(values), [values]);

  const problemFor = (field: keyof LayingValues): string | null => {
    const problem = lengthProblems.find((candidate) => candidate.field === field);
    if (!problem) return null;
    return t('length_exceeds', {
      label: problem.label,
      value: fmt(problem.value, 3),
      limit: fmt(problem.limit, 3),
    });
  };

  const trenchMissing = !values.pipe_length || !values.pipe_width || !values.pipe_depth;
  const murumIncomplete =
    values.include_murum === 1 &&
    (!values.murum_length || !values.murum_width || !values.murum_depth);

  const canSubmit =
    !!values.date &&
    !trenchMissing &&
    !murumIncomplete &&
    lengthProblems.length === 0 &&
    (!editing || syncState.online);

  const submit = async () => {
    setTouched(true);

    if (trenchMissing) {
      toast.err(t('fill_lwd'));
      return;
    }
    if (murumIncomplete) {
      toast.err(t('fill_murum_lwd'));
      return;
    }
    if (lengthProblems.length) {
      const first = lengthProblems[0];
      toast.err(
        t('length_exceeds', {
          label: first.label,
          value: fmt(first.value, 3),
          limit: fmt(first.limit, 3),
        }),
      );
      return;
    }

    if (editing && !syncState.online) {
      toast.err(t('edit_needs_online'));
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        // Online, in place — no outbox. The server replaces this batch's rows.
        await updateLayingBatch(cardName, editPipeId!, values);
        toast.ok(t('entry_updated'));
      } else {
        await sync.queueLayingBatch(cardName, values);
        // Let a fast connection finish so the new Pipe ID is on screen when we
        // go back; if it doesn't, the entry shows as pending instead.
        await new Promise((resolve) => window.setTimeout(resolve, 700));

        if (syncState.online) toast.ok(t('entry_saved'));
        else toast.info(t('saved_offline'));
      }

      onAdded();
      goBack({ name: 'card', id: cardName });
    } catch (error) {
      toast.err(error instanceof ApiError ? error.message : t('error_generic'));
    } finally {
      setSaving(false);
    }
  };

  const showTrench = touched && trenchMissing;

  return (
    <>
      <div className="pane">
        <div className="pad">
          {!syncState.online ? (
            <Note kind="warn" icon={<IconCloudOff />} style={{ marginBottom: 14 }}>
              {editing ? t('edit_needs_online') : t('working_offline')}
            </Note>
          ) : null}

          {/* ------------------------------------------------- date + party */}
          <div className="grid2">
            <DateField
              label={t('date')}
              value={values.date}
              onChange={(value) => set('date', value)}
              required
              max={todayISO()}
              t={t}
            />
            <Picker
              label={t('contractor')}
              value={values.select_contractor}
              onChange={(value) => {
                contractorTouched.current = true;
                set('select_contractor', value);
              }}
              options={cascade.contractorsFor(card?.project ?? null)}
              t={t}
              required
              icon={<IconHat />}
              emptyHint={t('no_results')}
            />
          </div>

          {/* ------------------------------------------------- excavation */}
          <div className="sec">
            <SectionHead
              icon={<IconRuler />}
              title={t('excavation')}
              value={fmt(totals.pipe_calculated_qty, 3)}
              unit={t('cum')}
            />
            <div className="grid3">
              <NumField
                mini
                label={t('length')}
                value={values.pipe_length}
                onChange={(value) => set('pipe_length', value)}
                error={showTrench && !values.pipe_length ? t('required') : null}
              />
              <NumField
                mini
                label={t('width')}
                value={values.pipe_width}
                onChange={(value) => set('pipe_width', value)}
                error={showTrench && !values.pipe_width ? t('required') : null}
              />
              <NumField
                mini
                label={t('depth')}
                value={values.pipe_depth}
                onChange={(value) => set('pipe_depth', value)}
                error={showTrench && !values.pipe_depth ? t('required') : null}
              />
            </div>
            <div style={{ marginTop: 8 }}>
              <Readout label={`${t('total_excavation')} (${t('cum')})`} value={totals.pipe_calculated_qty} />
            </div>
          </div>

          {/* ---------------------------------------------------- CC road */}
          <div className="sec">
            <SectionHead
              icon={<IconRoad />}
              title={t('cc_road')}
              value={fmt(totals.cc_qty, 3)}
              unit={t('cum')}
            />
            <div className="grid3">
              <NumField
                mini
                label={t('length')}
                value={values.cc_length}
                onChange={(value) => set('cc_length', value)}
                error={problemFor('cc_length')}
              />
              <NumField
                mini
                label={t('width')}
                value={values.cc_width}
                onChange={(value) => set('cc_width', value)}
              />
              <NumField
                mini
                label={t('depth')}
                value={values.cc_depth}
                onChange={(value) => set('cc_depth', value)}
              />
            </div>
          </div>

          {/* -------------------------------------------------- soft rock */}
          <div className="sec">
            <SectionHead
              icon={<IconDrop />}
              title={t('soft_rock')}
              value={fmt(totals.soft_qty, 3)}
              unit={t('cum')}
            />
            <div className="grid3">
              <NumField
                mini
                label={t('length')}
                value={values.soft_length}
                onChange={(value) => set('soft_length', value)}
                error={problemFor('soft_length')}
              />
              <NumField
                mini
                label={t('width')}
                value={values.soft_width}
                onChange={(value) => set('soft_width', value)}
              />
              <NumField
                mini
                label={t('depth')}
                value={values.soft_depth}
                onChange={(value) => set('soft_depth', value)}
              />
            </div>
          </div>

          {/* -------------------------------------------------- hard rock */}
          <div className="sec">
            <SectionHead
              icon={<IconMountain />}
              title={t('hard_rock')}
              value={fmt(totals.hard_qty, 3)}
              unit={t('cum')}
            />
            <div className="grid3">
              <NumField
                mini
                label={t('length')}
                value={values.hard_length}
                onChange={(value) => set('hard_length', value)}
                error={problemFor('hard_length')}
              />
              <NumField
                mini
                label={t('width')}
                value={values.hard_width}
                onChange={(value) => set('hard_width', value)}
              />
              <NumField
                mini
                label={t('depth')}
                value={values.hard_depth}
                onChange={(value) => set('hard_depth', value)}
              />
            </div>
          </div>

          {/* -------------------------------------------- soil excavation */}
          <div className="sec">
            <SectionHead
              icon={<IconRuler />}
              title={t('soil_excavation')}
              value={fmt(totals.soil_excavation_qty, 3)}
              unit={t('cum')}
            />
            <Readout
              label={t('soil_formula')}
              value={totals.soil_excavation_qty}
              warnNegative
            />
            {totals.soil_excavation_qty < 0 ? (
              <Note kind="err" icon={<IconAlert />} style={{ marginTop: 8 }}>
                {t('soil_negative')}
              </Note>
            ) : null}
          </div>

          {/* ------------------------------------------------------ laying */}
          {/* Mirrors the LIVE desk "Create New Pour Card" popup's Laying
              Details section exactly: Pipe Details + read-only Pipe Volume.
              Bedding / Strata are NOT part of that popup — they are hidden
              legacy fields on the child grid used by the Backfilling flow —
              so they are not collected on this create screen. */}
          <div className="sec">
            <SectionHead icon={<IconLayers />} title={t('sec_pipe')} />
            <Picker
              label={t('pipe_details')}
              value={values.pipe_details}
              onChange={(value) => set('pipe_details', value)}
              options={cascade.pipeItems}
              t={t}
              optional
              icon={<IconBox />}
              // The diameter is read out of the item name (e.g. "200mm HDPE").
              // Echoing it back confirms the app parsed the item the same way
              // the volume formula will.
              hint={
                values.pipe_details
                  ? `⌀ ${fmt(extractDiameterMm(values.pipe_details), 0)} ${t('mm')}`
                  : undefined
              }
            />
            <div style={{ marginTop: 8 }}>
              <Readout
                label={`${t('pipe_volume')} (${t('cum')})`}
                value={totals.pipe_volume}
                precision={4}
              />
            </div>
          </div>

          {/* ------------------------------------------------- backfilling */}
          <div className="sec">
            <SectionHead
              icon={<IconBox />}
              title={t('backfilling')}
              value={values.include_murum ? fmt(totals.murum_qty, 3) : undefined}
              unit={t('cum')}
            />
            <Toggle
              label={t('include_murum')}
              on={values.include_murum === 1}
              onChange={(on) => set('include_murum', on ? 1 : 0)}
            />

            {values.include_murum === 1 ? (
              <>
                <div className="grid3" style={{ marginTop: 10 }}>
                  <NumField
                    mini
                    label={t('length')}
                    value={values.murum_length}
                    onChange={(value) => set('murum_length', value)}
                    error={
                      problemFor('murum_length') ??
                      (touched && !values.murum_length ? t('required') : null)
                    }
                  />
                  <NumField
                    mini
                    label={t('width')}
                    value={values.murum_width}
                    onChange={(value) => set('murum_width', value)}
                    error={touched && !values.murum_width ? t('required') : null}
                  />
                  <NumField
                    mini
                    label={t('depth')}
                    value={values.murum_depth}
                    onChange={(value) => set('murum_depth', value)}
                    error={touched && !values.murum_depth ? t('required') : null}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Readout label={`${t('murum')} (${t('cum')})`} value={totals.murum_qty} />
                </div>
              </>
            ) : null}
          </div>

          {/* ------------------------------------------------- accessories */}
          <div className="sec">
            <SectionHead icon={<IconBox />} title={t('accessories')} />
            <div className="grid2">
              <Picker
                label={t('accessories')}
                value={values.accessories}
                onChange={(value) => set('accessories', value)}
                options={cascade.accItems}
                t={t}
                optional
                icon={<IconBox />}
              />
              <NumField
                mini
                label={t('quantity')}
                value={values.accessories_qty}
                onChange={(value) => set('accessories_qty', value)}
                integer
                optional
                t={t}
                error={
                  touched && values.accessories && !values.accessories_qty
                    ? t('required')
                    : null
                }
              />
            </div>
            <TextField
              label={t('remark')}
              value={values.remark}
              onChange={(value) => set('remark', value)}
              optional
              t={t}
              multiline
            />
          </div>

          <div className="divider" />
          <Note style={{ marginBottom: 14 }} icon={<IconCalendar />}>
            {editing ? t('edit_note') : t('pipe_id_note')}
          </Note>
        </div>
      </div>

      <div className="actionbar">
        <div className="btn-row">
          <button
            className="btn secondary"
            onClick={() => goBack({ name: 'card', id: cardName })}
            disabled={saving}
          >
            {t('cancel')}
          </button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={saving || !canSubmit}
            style={{ flex: '2 1 0' }}
          >
            {editing ? <IconCheck /> : <IconPlus />}
            <span>{editing ? t('save_changes') : t('add_entry')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
