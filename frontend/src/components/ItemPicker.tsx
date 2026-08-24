// Server-search item picker.
//
// The item catalogue has 3000+ rows, far too many to ship to the phone and
// filter client-side like the other pickers. This one queries the backend
// (item_search) as the user types — debounced, with the latest response
// winning — and opening it with no query shows the most recently touched items
// so a tap-and-pick still works without typing.

import { useEffect, useRef, useState } from 'react';
import { searchItems, type ItemHit } from '../api';
import { IconBox, IconChevronRight, IconSearch, IconX } from '../icons';
import { Sheet } from './Sheet';
import { tapLight } from '../haptics';
import type { T } from '../i18n';

interface ItemPickerProps {
  label: string;
  value: string | null;
  onChange: (item: ItemHit | null) => void;
  t: T;
  error?: string | null;
}

export function ItemPicker({ label, value, onChange, t, error }: ItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemHit[]>([]);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 340);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Debounced server search; a stale response never overwrites a newer one.
  useEffect(() => {
    if (!open) return;
    const id = ++reqId.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const hits = await searchItems(query.trim());
        if (reqId.current === id) setResults(hits);
      } catch {
        if (reqId.current === id) setResults([]);
      } finally {
        if (reqId.current === id) setLoading(false);
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
        ) : !results.length ? (
          <div className="empty-state">
            <IconSearch />
            <h3>{t('no_results')}</h3>
            {query ? <p>{query}</p> : null}
          </div>
        ) : (
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
        )}
      </Sheet>
    </div>
  );
}
