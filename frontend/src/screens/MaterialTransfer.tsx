// Material Transfer — move stock between warehouses.
//
// The one screen in the app that is deliberately ONLINE-ONLY. Everything else
// queues offline, but a transfer builds a real Stock Entry and ERPNext's own
// validation (negative stock, valuation, warehouse permissions) needs live
// stock to judge against. Queueing one would mean telling the user it worked
// and discovering hours later that the source warehouse never had the qty.
//
// Two-step like the desk form: Save Draft inserts a docstatus-0 Stock Entry,
// Submit posts it. Save-then-submit reuses the same draft, so a failed submit
// leaves one entry the user can fix — never a pile of orphaned drafts.

import { useEffect, useMemo, useState } from 'react';
import { fetchMtMasters, saveMaterialTransfer, submitMaterialTransfer, ApiError } from '../api';
import { Note, SectionHead, useToast } from '../components/Feedback';
import { DateField, NumField } from '../components/Fields';
import { ItemPicker, Picker, type Option } from '../components/Picker';
import { num, todayISO } from '../calc';
import { useStore } from '../store';
import {
  IconAlert,
  IconBuilding,
  IconCheck,
  IconCloudOff,
  IconPin,
  IconPlus,
  IconTrash,
} from '../icons';
import type { ItemHit, MtLine, MtMasters, MtPayload } from '../types';

let nextLineId = 1;

function emptyLine(): MtLine {
  return { _id: nextLineId++, item_code: '', item_name: '', qty: 0, uom: null, basic_rate: 0 };
}

export function MaterialTransfer() {
  const { t, syncState } = useStore();
  const toast = useToast();

  const [masters, setMasters] = useState<MtMasters | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [company, setCompany] = useState<string | null>(null);
  const [postingDate, setPostingDate] = useState(todayISO());
  const [fromWarehouse, setFromWarehouse] = useState<string | null>(null);
  const [toWarehouse, setToWarehouse] = useState<string | null>(null);
  const [lines, setLines] = useState<MtLine[]>(() => [emptyLine()]);

  // The draft this screen is editing, once one exists. Kept so Save → Submit
  // updates that entry instead of inserting a second one.
  const [draftName, setDraftName] = useState<string | null>(null);
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
        if (!cancelled) {
          setLoadError(error instanceof ApiError ? error.message : t('error_generic'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const warehouseOptions: Option[] = useMemo(
    () =>
      (masters?.warehouses ?? []).map((warehouse) => ({
        value: warehouse.name,
        meta: warehouse.company ?? undefined,
      })),
    [masters],
  );

  const companyOptions: Option[] = useMemo(
    () => (masters?.companies ?? []).map((item) => ({ value: item.name })),
    [masters],
  );

  // Any edit invalidates the saved draft's contents, so drop the reference and
  // let the next save write a fresh one rather than silently diverging from it.
  const dirty = () => setDraftName(null);

  const patchLine = (id: number, patch: Partial<MtLine>) => {
    dirty();
    setLines((current) =>
      current.map((line) => (line._id === id ? { ...line, ...patch } : line)),
    );
  };

  const addLine = () => {
    dirty();
    setLines((current) => [...current, emptyLine()]);
  };

  const removeLine = (id: number) => {
    dirty();
    setLines((current) => {
      const kept = current.filter((line) => line._id !== id);
      // Never leave the table empty — an empty item list has no affordance to
      // add the first row back.
      return kept.length ? kept : [emptyLine()];
    });
  };

  const filled = lines.filter((line) => line.item_code && num(line.qty) > 0);

  const errors = useMemo(() => {
    const found: string[] = [];
    if (!company) found.push(t('company_required'));
    if (!fromWarehouse) found.push(t('source_wh_required'));
    if (!toWarehouse) found.push(t('target_wh_required'));
    if (fromWarehouse && toWarehouse && fromWarehouse === toWarehouse) {
      found.push(t('same_warehouse'));
    }
    if (!filled.length) found.push(t('add_one_item'));
    return found;
  }, [company, fromWarehouse, toWarehouse, filled.length, t]);

  const canAct =
    !errors.length && !busy && syncState.online && (masters?.can_create ?? true);

  const payload = (name: string | null): MtPayload => ({
    company,
    posting_date: postingDate,
    from_warehouse: fromWarehouse,
    to_warehouse: toWarehouse,
    items: filled.map((line) => ({
      item_code: line.item_code,
      qty: num(line.qty),
      uom: line.uom,
      basic_rate: line.basic_rate ? num(line.basic_rate) : null,
    })),
    name: name ?? undefined,
  });

  const persistDraft = async (): Promise<string> => {
    const saved = await saveMaterialTransfer(payload(draftName));
    setDraftName(saved.name);
    return saved.name;
  };

  const guard = (): boolean => {
    setTouched(true);
    if (!syncState.online) {
      toast.err(t('mt_needs_online'));
      return false;
    }
    if (errors.length) {
      toast.err(errors[0]);
      return false;
    }
    return true;
  };

  const onSaveDraft = async () => {
    if (!guard()) return;
    setBusy(true);
    try {
      const name = await persistDraft();
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
      const name = await persistDraft();
      const result = await submitMaterialTransfer(name);
      toast.ok(t('mt_submitted', { name: result.name }));

      // Submitted entries are immutable, so reset to a blank form rather than
      // leaving the user staring at a document they can no longer change.
      setDraftName(null);
      setFromWarehouse(null);
      setToWarehouse(null);
      setLines([emptyLine()]);
      setTouched(false);
    } catch (error) {
      toast.err(error instanceof ApiError ? error.message : t('error_generic'));
    } finally {
      setBusy(false);
    }
  };

  const lineError = (line: MtLine) =>
    touched && !line.item_code && num(line.qty) > 0 ? t('pick_item') : null;

  return (
    <>
      <div className="pane">
        <div className="pad">
          {syncState.online ? null : (
            <Note kind="warn" icon={<IconCloudOff />} style={{ marginBottom: 14 }}>
              {t('mt_needs_online')}
            </Note>
          )}

          {loadError ? (
            <Note kind="err" icon={<IconAlert />} style={{ marginBottom: 14 }}>
              {loadError}
            </Note>
          ) : null}

          {masters && !masters.can_create ? (
            <Note kind="err" icon={<IconAlert />} style={{ marginBottom: 14 }}>
              {t('mt_no_permission')}
            </Note>
          ) : null}

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
              value={postingDate}
              onChange={setPostingDate}
              required
              max={todayISO()}
              t={t}
            />

            <div className="grid2">
              <Picker
                label={t('source_warehouse')}
                value={fromWarehouse}
                onChange={(value) => {
                  dirty();
                  setFromWarehouse(value);
                }}
                options={warehouseOptions}
                t={t}
                required
                icon={<IconPin />}
                emptyHint={t('no_results')}
                error={touched && !fromWarehouse ? t('required') : null}
              />

              <Picker
                label={t('target_warehouse')}
                value={toWarehouse}
                onChange={(value) => {
                  dirty();
                  setToWarehouse(value);
                }}
                options={warehouseOptions}
                t={t}
                required
                icon={<IconPin />}
                emptyHint={t('no_results')}
                error={
                  touched && (!toWarehouse || toWarehouse === fromWarehouse)
                    ? t(
                        toWarehouse && toWarehouse === fromWarehouse
                          ? 'same_warehouse'
                          : 'required',
                      )
                    : null
                }
              />
            </div>
          </div>

          <div className="sec">
            <SectionHead
              icon={<IconPlus />}
              title={t('items')}
              value={filled.length ? String(filled.length) : undefined}
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
                    patchLine(line._id, {
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
                    onChange={(value) => patchLine(line._id, { qty: value })}
                    error={touched && line.item_code && !num(line.qty) ? t('required') : null}
                  />

                  <NumField
                    mini
                    label={t('basic_rate')}
                    value={line.basic_rate}
                    onChange={(value) => patchLine(line._id, { basic_rate: value })}
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
            <span>{t(busy ? 'please_wait' : 'submit_transfer')}</span>
          </button>
        </div>
      </div>
    </>
  );
}
