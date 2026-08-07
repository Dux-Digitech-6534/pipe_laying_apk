// Link and Select controls, rebuilt as native-style pickers.
//
// A Frappe Link field on the desk is a text input with an autocomplete dropdown,
// and a Select is a native <select>. Neither works well on a phone in the field:
// the dropdown is tiny, typing is slow with gloves on, and the native select
// menu can't show the second line of context (which project a zone belongs to).
//
// Instead: tapping the control opens a bottom sheet with 54px rows, a search box
// for long lists, group headers, and the current value ticked. That is the
// pattern users already know from every contacts / bank / ride app.

import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { IconAlert, IconBox, IconCheck, IconChevronRight, IconSearch, IconX } from '../icons';
import { Sheet } from './Sheet';
import { searchItems } from '../api';
import { tapLight } from '../haptics';
import type { T } from '../i18n';
import type { ItemHit } from '../types';

export interface Option {
  value: string;
  /** Primary line. Defaults to `value`. */
  label?: string;
  /** Second line — the context that makes an ambiguous name decidable. */
  meta?: string;
  /** Right-aligned chip, e.g. an item group. */
  tag?: string;
  /** Section header this option sits under. */
  group?: string;
}

interface PickerProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: Option[];
  t: T;
  placeholder?: string;
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  /** Shown in place of the option list when there is nothing to pick yet. */
  emptyHint?: string;
  hint?: string;
  error?: string | null;
  /** Force the search box on/off. Default: on for lists over 8 options. */
  searchable?: boolean;
  clearable?: boolean;
  /** Leading glyph, matching the prototype where every control carries one. */
  icon?: ReactNode;
  mini?: boolean;
}

/** A searchable single-select. Used for every Link field and every Select field
 *  in the app, so both read identically to the user. */
export function Picker({
  label,
  value,
  onChange,
  options,
  t,
  placeholder,
  required,
  optional,
  disabled,
  emptyHint,
  hint,
  error,
  searchable,
  clearable = true,
  icon,
  mini,
}: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? options.length > 8;

  // Keep the focus-on-open out of the render path; autofocus fights the sheet's
  // entry animation on Android and can scroll the sheet half off-screen.
  useEffect(() => {
    if (!open || !showSearch) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 340);
    return () => window.clearTimeout(timer);
  }, [open, showSearch]);

  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => {
      const haystack = `${option.label ?? option.value} ${option.meta ?? ''} ${option.tag ?? ''}`;
      return haystack.toLowerCase().includes(needle);
    });
  }, [options, query]);

  // Group headers only earn their space when the list actually has groups and
  // isn't being narrowed to a handful of matches.
  const grouped = useMemo(() => {
    const hasGroups = filtered.some((option) => option.group);
    if (!hasGroups) return [{ group: null as string | null, items: filtered }];

    const order: string[] = [];
    const buckets = new Map<string, Option[]>();
    for (const option of filtered) {
      const key = option.group ?? '';
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(key);
      }
      buckets.get(key)!.push(option);
    }
    return order.map((key) => ({ group: key || null, items: buckets.get(key)! }));
  }, [filtered]);

  const openSheet = () => {
    if (disabled) return;
    tapLight();
    setQuery('');
    setOpen(true);
  };

  const choose = (next: string) => {
    tapLight();
    onChange(next === value ? value : next);
    setOpen(false);
  };

  return (
    <div className={`field${mini ? ' mini' : ''}`}>
      <label>
        <span>{label}</span>
        {required ? <span className="req"> *</span> : null}
        {optional ? <span className="optional"> {t('optional')}</span> : null}
      </label>

      <button
        type="button"
        className={`control tap${error ? ' invalid' : ''}`}
        onClick={openSheet}
        disabled={disabled}
      >
        {icon}
        <span className={`val${selected ? '' : ' empty'}`}>
          {selected ? selected.label ?? selected.value : placeholder ?? t('select')}
        </span>
        <IconChevronRight className="chev-r" size="sm" />
      </button>

      {error ? (
        <div className="field-error">
          <IconAlert />
          <span>{error}</span>
        </div>
      ) : hint ? (
        <div className="field-hint">{hint}</div>
      ) : null}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        subtitle={
          options.length
            ? `${filtered.length} ${filtered.length === 1 ? 'option' : 'options'}`
            : undefined
        }
        toolbar={
          showSearch && options.length ? (
            <div className="control">
              <IconSearch />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('search')}
                inputMode="search"
                autoComplete="off"
              />
              {query ? (
                <button
                  className="iconbtn plain"
                  style={{ width: 26, height: 26 }}
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  aria-label={t('clear')}
                >
                  <IconX size="sm" />
                </button>
              ) : null}
            </div>
          ) : undefined
        }
        footer={
          clearable && value ? (
            <button
              className="btn secondary"
              onClick={() => {
                tapLight();
                onChange(null);
                setOpen(false);
              }}
            >
              <IconX size="sm" />
              {t('clear')}
            </button>
          ) : undefined
        }
      >
        {!options.length ? (
          <div className="empty-state">
            <IconSearch />
            <h3>{emptyHint ?? t('no_results')}</h3>
          </div>
        ) : !filtered.length ? (
          <div className="empty-state">
            <IconSearch />
            <h3>{t('no_results')}</h3>
            <p>{query}</p>
          </div>
        ) : (
          grouped.map((bucket) => (
            <div key={bucket.group ?? '_'}>
              {bucket.group ? <div className="opt-group">{bucket.group}</div> : null}
              {bucket.items.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`opt${option.value === value ? ' selected' : ''}`}
                  onClick={() => choose(option.value)}
                >
                  <div className="opt-main">
                    <div className="opt-name">{option.label ?? option.value}</div>
                    {option.meta ? <div className="opt-meta">{option.meta}</div> : null}
                  </div>
                  {option.tag ? <span className="opt-tag">{option.tag}</span> : null}
                  {option.value === value ? (
                    <IconCheck size="sm" className="opt-check" />
                  ) : null}
                </button>
              ))}
            </div>
          ))
        )}
      </Sheet>
    </div>
  );
}

interface MultiPickerProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: Option[];
  t: T;
  triggerLabel?: string;
  emptyHint?: string;
}

/** Multi-select sheet with checkboxes and a select-all. Used by Backfilling to
 *  pick which pipe rows to calculate. */
export function MultiPicker({
  label,
  values,
  onChange,
  options,
  t,
  triggerLabel,
  emptyHint,
}: MultiPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(values);

  const openSheet = () => {
    tapLight();
    setDraft(values);
    setOpen(true);
  };

  const toggle = (value: string) => {
    tapLight();
    setDraft((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  };

  const allSelected = options.length > 0 && draft.length === options.length;

  return (
    <>
      <button type="button" className="btn secondary" onClick={openSheet}>
        {triggerLabel ?? label}
        {values.length ? ` · ${values.length}` : ''}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        subtitle={`${draft.length} / ${options.length}`}
        footer={
          <div className="btn-row">
            <button
              className="btn secondary"
              onClick={() => {
                tapLight();
                setDraft(allSelected ? [] : options.map((option) => option.value));
              }}
            >
              {allSelected ? t('clear') : t('all')}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                tapLight();
                onChange(draft);
                setOpen(false);
              }}
            >
              {t('done')}
            </button>
          </div>
        }
      >
        {!options.length ? (
          <div className="empty-state">
            <IconSearch />
            <h3>{emptyHint ?? t('no_results')}</h3>
          </div>
        ) : (
          options.map((option) => {
            const on = draft.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`opt${on ? ' selected' : ''}`}
                onClick={() => toggle(option.value)}
              >
                <span className={`checkbox${on ? ' on' : ''}`}>
                  <IconCheck />
                </span>
                <div className="opt-main">
                  <div className="opt-name">{option.label ?? option.value}</div>
                  {option.meta ? <div className="opt-meta">{option.meta}</div> : null}
                </div>
              </button>
            );
          })
        )}
      </Sheet>
    </>
  );
}

interface ItemPickerProps {
  label: string;
  value: string | null;
  onChange: (item: ItemHit | null) => void;
  t: T;
  error?: string | null;
}

/**
 * Item lookup for Material Transfer.
 *
 * Unlike Picker, the options are not held in memory: this site carries 3000+
 * items, far too many to ship to the phone with the other masters. Each
 * keystroke queries the server instead, debounced so a typist fires one request
 * rather than one per letter, and race-guarded so a slow early response can
 * never overwrite the results of a later query.
 */
export function ItemPicker({ label, value, onChange, t, error }: ItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemHit[]>([]);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 340);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const mine = ++seq.current;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const hits = await searchItems(query.trim());
        if (seq.current === mine) setResults(hits);
      } catch {
        // An empty list reads as "nothing matched", which is the honest state
        // when we could not reach the server.
        if (seq.current === mine) setResults([]);
      } finally {
        if (seq.current === mine) setLoading(false);
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query, open]);

  const openSheet = () => {
    tapLight();
    setQuery('');
    setResults([]);
    setOpen(true);
  };

  const choose = (item: ItemHit) => {
    tapLight();
    onChange(item);
    setOpen(false);
  };

  return (
    <div className="field">
      <label>
        <span>{label}</span>
      </label>

      <button
        type="button"
        className={`control tap${error ? ' invalid' : ''}`}
        onClick={openSheet}
      >
        <IconBox />
        <span className={`val${value ? '' : ' empty'}`}>{value ?? t('select_item')}</span>
        <IconChevronRight className="chev-r" size="sm" />
      </button>

      {error ? (
        <div className="field-error">
          <span>{error}</span>
        </div>
      ) : null}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        toolbar={
          <div className="control">
            <IconSearch />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('search_item')}
              inputMode="search"
              autoComplete="off"
            />
            {query ? (
              <button
                className="iconbtn plain"
                style={{ width: 26, height: 26 }}
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label={t('clear')}
              >
                <IconX size="sm" />
              </button>
            ) : null}
          </div>
        }
      >
        {loading ? (
          <div className="empty-state">
            <IconSearch />
            <h3>{t('loading')}</h3>
          </div>
        ) : results.length ? (
          results.map((item) => (
            <button
              key={item.name}
              type="button"
              className={`opt${item.name === value ? ' selected' : ''}`}
              onClick={() => choose(item)}
            >
              <div className="opt-main">
                <div className="opt-name">{item.name}</div>
                {item.item_name && item.item_name !== item.name ? (
                  <div className="opt-meta">{item.item_name}</div>
                ) : null}
              </div>
              {item.item_group ? <span className="opt-tag">{item.item_group}</span> : null}
            </button>
          ))
        ) : (
          <div className="empty-state">
            <IconSearch />
            <h3>{t('no_results')}</h3>
            {query ? <p>{query}</p> : null}
          </div>
        )}
      </Sheet>
    </div>
  );
}
