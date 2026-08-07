// Backfilling calculator.
//
// Mirrors the desk "Backfilling" button: pick pipe rows, pick a date, see the
// numbers. Formula (unchanged):
//   Total Excavation = L × W × D
//   Murum            = L × W × Bedding
//   Pipe Volume      = (3.14 × d² / 4) × L
//   Backfilling      = Total Excavation − Murum − Pipe Volume
//
// The desk version only displays the result — it never writes it, so the
// Backfilling Details table stays empty there. This screen matches that by
// default and adds an explicit "Save to Pour Card" for when persisting is
// wanted, which is what the table was added for.

import { useEffect, useMemo, useState } from 'react';
import { calcBackfillRow, fmt, num, todayISO } from '../calc';
import { saveBackfilling } from '../api';
import { useStore } from '../store';
import { DateField } from '../components/Fields';
import { MultiPicker } from '../components/Picker';
import { EmptyState, Note, SectionHead, useToast } from '../components/Feedback';
import {
  IconBox,
  IconCalculator,
  IconCheck,
  IconInfo,
  IconLayers,
  IconRuler,
} from '../icons';
import type { CardDetail } from '../types';

export function Backfilling({ card, onReload }: { card: CardDetail | null; onReload: () => void }) {
  const { t, syncState } = useStore();
  const toast = useToast();

  const [date, setDate] = useState(todayISO());
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const rows = card?.pipe ?? [];
  const murumRows = card?.murum ?? [];

  // Default to every row: the common case is "calculate the whole card", and
  // pre-selecting saves a trip into the picker.
  useEffect(() => {
    if (rows.length && !selected.length) {
      setSelected(rows.map((row) => row.pipe_id ?? String(row.idx)));
    }
  }, [rows.length]);

  const options = useMemo(
    () =>
      rows.map((row) => ({
        value: row.pipe_id ?? String(row.idx),
        label: row.pipe_id ?? `#${row.idx}`,
        meta: [
          (row.pipe_details as string) ?? null,
          `${fmt(num(row.length_of_pipemtr), 2)} × ${fmt(num(row.width_of_pipemtr), 2)} × ${fmt(
            num(row.depth_of_pipemtr),
            2,
          )}`,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    [rows],
  );

  const calculated = useMemo(() => {
    const keys = new Set(selected);
    return rows
      .filter((row) => keys.has(row.pipe_id ?? String(row.idx)))
      .map((row) => {
        const length = num(row.length_of_pipemtr);
        const width = num(row.width_of_pipemtr);
        const depth = num(row.depth_of_pipemtr);
        const bedding = num(row.custom_bedding);

        // Murum comes from the Murum Details rows the operator filled in, keyed
        // by the pipe id the batch shares. The desk derives it from bedding
        // depth instead, which nothing writes — so it always read 0 here.
        const murumQty = murumRows
          .filter((m) => row.pipe_id && m.pipe_id === row.pipe_id)
          .reduce(
            (sum, m) =>
              sum +
              num(m.hard_rock_lengthmtr) *
                num(m.hard_rock_widthmtr) *
                num(m.hard_rock_depthmtr),
            0,
          );

        const result = calcBackfillRow({
          pipe_details: row.pipe_details as string,
          length,
          width,
          depth,
          murum_qty: murumQty,
        });

        return {
          key: row.pipe_id ?? String(row.idx),
          pipeId: row.pipe_id ?? `#${row.idx}`,
          pipeDetails: (row.pipe_details as string) ?? '—',
          length,
          width,
          depth,
          bedding,
          ...result,
        };
      });
  }, [rows, murumRows, selected]);

  const totals = useMemo(
    () =>
      calculated.reduce(
        (accumulator, row) => ({
          total_excavation: accumulator.total_excavation + row.total_excavation,
          murum_qty: accumulator.murum_qty + row.murum_qty,
          pipe_volume: accumulator.pipe_volume + row.pipe_volume,
          backfilling_qty: accumulator.backfilling_qty + row.backfilling_qty,
        }),
        { total_excavation: 0, murum_qty: 0, pipe_volume: 0, backfilling_qty: 0 },
      ),
    [calculated],
  );

  const anyBedding = calculated.some((row) => row.bedding > 0);

  const persist = async () => {
    if (!card || !calculated.length) return;

    setSaving(true);
    try {
      await saveBackfilling(card.name, selected, date);
      toast.ok(t('backfill_saved'));
      onReload();
    } catch (error) {
      toast.err(error instanceof Error ? error.message : t('error_generic'));
    } finally {
      setSaving(false);
    }
  };

  if (!rows.length) {
    return (
      <div className="pane">
        <div className="pad">
          <EmptyState icon={<IconCalculator />} title={t('no_pipe_rows')} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pane">
        <div className="pad">
          <div className="card">
            <DateField
              label={t('date')}
              value={date}
              onChange={setDate}
              required
              max={todayISO()}
              t={t}
            />
            <MultiPicker
              label={t('select_rows')}
              values={selected}
              onChange={setSelected}
              options={options}
              t={t}
            />
          </div>

          {!anyBedding ? (
            <Note kind="warn" icon={<IconInfo />} style={{ marginTop: 12 }}>
              {t('backfill_note')}
            </Note>
          ) : null}

          <SectionHead icon={<IconCalculator />} title={t('backfilling')} />

          {!calculated.length ? (
            <EmptyState icon={<IconCalculator />} title={t('select_rows')} />
          ) : (
            <>
              <div className="stats" style={{ marginBottom: 14 }}>
                <div className="stat">
                  <div className="sv">
                    {fmt(totals.total_excavation, 2)} <small>{t('cum')}</small>
                  </div>
                  <div className="sl">
                    <IconRuler />
                    <span>{t('total_excavation')}</span>
                  </div>
                </div>
                <div className="stat">
                  <div className="sv">
                    {fmt(totals.pipe_volume, 2)} <small>{t('cum')}</small>
                  </div>
                  <div className="sl">
                    <IconLayers />
                    <span>{t('pipe_volume')}</span>
                  </div>
                </div>
                <div className="stat">
                  <div className="sv">
                    {fmt(totals.murum_qty, 2)} <small>{t('cum')}</small>
                  </div>
                  <div className="sl">
                    <IconBox />
                    <span>{t('murum')}</span>
                  </div>
                </div>
                <div className="stat">
                  <div className="sv">
                    {fmt(totals.backfilling_qty, 2)} <small>{t('cum')}</small>
                  </div>
                  <div className="sl">
                    <IconCalculator />
                    <span>{t('backfilling')}</span>
                  </div>
                </div>
              </div>

              <div className="card flush">
                <div className="dtable">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('pipe_id')}</th>
                        <th>⌀ {t('mm')}</th>
                        <th>{t('total_excavation')}</th>
                        <th>{t('murum')}</th>
                        <th>{t('pipe_volume')}</th>
                        <th>{t('backfilling')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calculated.map((row) => (
                        <tr key={row.key}>
                          <td className="label">{row.pipeId}</td>
                          <td>{fmt(row.diameter_mm, 0)}</td>
                          <td>{fmt(row.total_excavation, 3)}</td>
                          <td>{fmt(row.murum_qty, 3)}</td>
                          <td>{fmt(row.pipe_volume, 4)}</td>
                          <td className="hi">{fmt(row.backfilling_qty, 4)}</td>
                        </tr>
                      ))}
                      <tr className="total">
                        <td className="label">{t('total_cards')}</td>
                        <td />
                        <td>{fmt(totals.total_excavation, 3)}</td>
                        <td>{fmt(totals.murum_qty, 3)}</td>
                        <td>{fmt(totals.pipe_volume, 4)}</td>
                        <td className="hi">{fmt(totals.backfilling_qty, 4)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {calculated.length ? (
        <div className="actionbar">
          <button
            className="btn primary"
            onClick={persist}
            disabled={saving || !syncState.online}
          >
            <IconCheck size="sm" />
            {syncState.online ? t('save_backfilling') : t('offline')}
          </button>
        </div>
      ) : null}
    </>
  );
}
