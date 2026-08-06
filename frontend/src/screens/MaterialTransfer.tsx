// Material Transfer — create a Stock Entry (Material Transfer) from the phone.
//
// A faithful mobile port of the desk "Material Transfer" page: a header
// (company, posting date, source & target warehouse) plus item lines. It calls
// the SAME backend endpoints the desk page uses (pipe_laying_inhouse.api
// .save_material_transfer / .submit_material_transfer), so a real Stock Entry is
// built and ERPNext's own validate() runs — negative stock, valuation, the lot.
//
// Online-only, on purpose: stock rules need live data, and an offline queue
// could hold transfers that only fail validation on sync. The rest of the app
// stays offline-first; this one screen requires a connection.
//
// The header source/target warehouses apply to every line (the server fills each
// row's s_/t_warehouse from them), which covers the common "move these items
// from A to B" case without a per-row warehouse grid on a phone.

import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  fetchMtMasters,
  saveMaterialTransfer,
  submitMaterialTransfer,
  type ItemHit,
  type MtItem,
  type MtMasters,
} from '../api';
import { num, todayISO } from '../calc';
import { useStore } from '../store';
import { Picker } from '../components/Picker';
import { ItemPicker } from '../components/ItemPicker';
import { DateField, NumField } from '../components/Fields';
import { Note, SectionHead, useToast } from '../components/Feedback';
import {
  IconAlert,
  IconBuilding,
  IconCheck,
  IconCloudOff,
  IconPin,
  IconPlus,
  IconTrash,
} from '../icons';

interface Line {
  _id: number;
  item_code: string;
  item_name: string;
  qty: number;
  uom: string | null;
  basic_rate: number;
}

let LINE_SEQ = 1;
function blankLine(): Line {
  return { _id: LINE_SEQ++, item_code: '', item_name: '', qty: 0, uom: null, basic_rate: 0 };
}

export function MaterialTransfer() {
  const { t, syncState } = useStore();
  const toast = useToast();

  const [masters, setMasters] = useState<MtMasters | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [company, setCompany] = useState<string | null>(null);
  const [date, setDate] = useState(todayISO());
  const [sourceWh, setSourceWh] = useState<string | null>(null);
  const [targetWh, setTargetWh] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);

  const [savedName, setSavedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchMtMasters();
        if (cancelled) return;
        setMasters(loaded);
        setCompany((current) => current ?? loaded.default_company);
      } catch (error) {
        if (!cancelled) setLoadErr(error instanceof ApiError ? error.message : t('error_generic'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const warehouseOptions = useMemo(
    () =>
      (masters?.warehouses ?? []).map((w) => ({
        value: w.name,
        meta: w.company ?? undefined,
      })),
    [masters],
  );
  const companyOptions = useMemo(
    () => (masters?.companies ?? []).map((c) => ({ value: c.name })),
    [masters],
  );

  // Any edit invalidates a previously saved draft — the next submit re-saves.
  const dirty = () => setSavedName(null);

  const setLine = (id: number, patch: Partial<Line>) => {
    dirty();
    setLines((current) => current.map((line) => (line._id === id ? { ...line, ...patch } : line)));
  };
  const addLine = () => {
    dirty();
    setLines((current) => [...current, blankLine()]);
  };
  const removeLine = (id: number) => {
    dirty();
    setLines((current) => {
      const next = current.filter((line) => line._id !== id);
      return next.length ? next : [blankLine()];
    });
  };

  const validLines = lines.filter((line) => line.item_code && num(line.qty) > 0);

  const problems = useMemo(() => {
    const found: string[] = [];
    if (!company) found.push(t('company_required'));
    if (!sourceWh) found.push(t('source_wh_required'));
    if (!targetWh) found.push(t('target_wh_required'));
    if (sourceWh && targetWh && sourceWh === targetWh) found.push(t('same_warehouse'));
    if (!validLines.length) found.push(t('add_one_item'));
    return found;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, sourceWh, targetWh, validLines.length, t]);

  const canAct =
    !problems.length && !busy && syncState.online && (masters?.can_create ?? true);

  const buildPayload = (name: string | null) => ({
    company,
    posting_date: date,
    from_warehouse: sourceWh,
    to_warehouse: targetWh,
    items: validLines.map<MtItem>((line) => ({
      item_code: line.item_code,
      qty: num(line.qty),
      uom: line.uom,
      basic_rate: line.basic_rate ? num(line.basic_rate) : null,
    })),
    name: name ?? undefined,
  });

  const persist = async (): Promise<string> => {
    const result = await saveMaterialTransfer(buildPayload(savedName));
    setSavedName(result.name);
    return result.name;
  };

  const guard = (): boolean => {
    setTouched(true);
    if (!syncState.online) {
      toast.err(t('mt_needs_online'));
      return false;
    }
    if (problems.length) {
      toast.err(problems[0]);
      return false;
    }
    return true;
  };

  const onSaveDraft = async () => {
    if (!guard()) return;
    setBusy(true);
    try {
      const name = await persist();
      toast.ok(t('mt_saved', { name }));
    } catch (error) {
      toast.err(error instanceof ApiError ? error.message : t('error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!guard()) return;
    setBusy(true);
    try {
      const name = await persist(); // save latest edits (insert or update) first
      const result = await submitMaterialTransfer(name);
      toast.ok(t('mt_submitted', { name: result.name }));
      // Reset for the next transfer, keeping company + date for a quick repeat.
      setSavedName(null);
      setSourceWh(null);
      setTargetWh(null);
      setLines([blankLine()]);
      setTouched(false);
    } catch (error) {
      toast.err(error instanceof ApiError ? error.message : t('error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const lineError = (line: Line): string | null => {
    if (!touched) return null;
    if (!line.item_code && num(line.qty) > 0) return t('pick_item');
    return null;
  };

  return (
    <>
      <div className="pane">
        <div className="pad">
          {!syncState.online ? (
            <Note kind="warn" icon={<IconCloudOff />} style={{ marginBottom: 14 }}>
              {t('mt_needs_online')}
            </Note>
          ) : null}

          {loadErr ? (
            <Note kind="err" icon={<IconAlert />} style={{ marginBottom: 14 }}>
              {loadErr}
            </Note>
          ) : null}

          {masters && !masters.can_create ? (
            <Note kind="err" icon={<IconAlert />} style={{ marginBottom: 14 }}>
              {t('mt_no_permission')}
            </Note>
          ) : null}

          {/* --------------------------------------------- transfer details */}
          <div className="sec">
            <SectionHead icon={<IconBuilding />} title={t('mt_details')} />

            <Picker
              label={t('company')}
              value={company}
              onChange={setCompany}
              options={companyOptions}
              t={t}
              required
              icon={<IconBuilding />}
              error={touched && !company ? t('required') : null}
            />

            <DateField
              label={t('posting_date')}
              value={date}
              onChange={setDate}
              required
              max={todayISO()}
              t={t}
            />

            <div className="grid2">
              <Picker
                label={t('source_warehouse')}
                value={sourceWh}
                onChange={(value) => {
                  dirty();
                  setSourceWh(value);
                }}
                options={warehouseOptions}
                t={t}
                required
                icon={<IconPin />}
                emptyHint={t('no_results')}
                error={touched && !sourceWh ? t('required') : null}
              />
              <Picker
                label={t('target_warehouse')}
                value={targetWh}
                onChange={(value) => {
                  dirty();
                  setTargetWh(value);
                }}
                options={warehouseOptions}
                t={t}
                required
                icon={<IconPin />}
                emptyHint={t('no_results')}
                error={
                  touched && (!targetWh || targetWh === sourceWh)
                    ? targetWh && targetWh === sourceWh
                      ? t('same_warehouse')
                      : t('required')
                    : null
                }
              />
            </div>
          </div>

          {/* ------------------------------------------------------- items */}
          <div className="sec">
            <SectionHead
              icon={<IconPlus />}
              title={t('items')}
              value={validLines.length ? String(validLines.length) : undefined}
            />

            {lines.map((line) => (
              <div className="mt-line" key={line._id}>
                <button
                  type="button"
                  className="mt-line-x"
                  onClick={() => removeLine(line._id)}
                  aria-label={t('remove')}
                >
                  <IconTrash size="sm" />
                </button>

                <ItemPicker
                  label={t('item')}
                  value={line.item_code || null}
                  onChange={(item: ItemHit | null) =>
                    setLine(line._id, {
                      item_code: item?.name ?? '',
                      item_name: item?.item_name ?? '',
                      uom: item?.stock_uom ?? null,
                    })
                  }
                  t={t}
                  error={lineError(line)}
                />

                {line.item_name && line.item_name !== line.item_code ? (
                  <div className="mt-line-sub">{line.item_name}</div>
                ) : null}

                <div className="grid2">
                  <NumField
                    mini
                    label={t('qty')}
                    unit={line.uom ?? undefined}
                    value={line.qty}
                    onChange={(value) => setLine(line._id, { qty: value })}
                    error={touched && line.item_code && !num(line.qty) ? t('required') : null}
                  />
                  <NumField
                    mini
                    label={t('basic_rate')}
                    value={line.basic_rate}
                    onChange={(value) => setLine(line._id, { basic_rate: value })}
                    optional
                    t={t}
                  />
                </div>
              </div>
            ))}

            <button type="button" className="mt-add" onClick={addLine}>
              <IconPlus size="sm" />
              <span>{t('add_item')}</span>
            </button>
          </div>

          <div className="divider" />
          <Note icon={<IconCheck />} style={{ marginBottom: 14 }}>
            {t('mt_note')}
          </Note>
        </div>
      </div>

      <div className="actionbar">
        <div className="btn-row">
          <button className="btn secondary" onClick={onSaveDraft} disabled={!canAct}>
            {t('save_draft')}
          </button>
          <button
            className="btn primary"
            onClick={onSubmit}
            disabled={!canAct}
            style={{ flex: '2 1 0' }}
          >
            <IconCheck />
            <span>{busy ? t('please_wait') : t('submit_transfer')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
