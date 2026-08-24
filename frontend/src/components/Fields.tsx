// Form controls, built on the prototype's `.field` + `.control` anatomy:
// a small label above, then a 44px row with a leading icon, the value, and an
// optional trailing affordance. Numeric inputs use `.mono` (mono face, data
// colour); computed outputs use `.ro` (sunken + dashed, not tappable).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconAlert, IconCalendar } from '../icons';
import { tapLight } from '../haptics';
import { fmt, fmtDate } from '../calc';
import type { T } from '../i18n';

interface LabelProps {
  label: string;
  required?: boolean;
  optional?: boolean;
  unit?: string;
  t?: T;
}

function FieldLabel({ label, required, optional, unit, t }: LabelProps) {
  return (
    <label>
      {unit ? <span className="unit">{unit}</span> : null}
      <span>{label}</span>
      {required ? <span className="req"> *</span> : null}
      {optional && t ? <span className="optional"> {t('optional')}</span> : null}
    </label>
  );
}

function FieldFoot({ error, hint }: { error?: string | null; hint?: string }) {
  if (error) {
    return (
      <div className="field-error">
        <IconAlert />
        <span>{error}</span>
      </div>
    );
  }
  if (hint) return <div className="field-hint">{hint}</div>;
  return null;
}

// ---------------------------------------------------------------- numeric

interface NumFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  /** Integers only (accessory quantity). */
  integer?: boolean;
  placeholder?: string;
  /** Compact variant for the dense L/W/D triples. */
  mini?: boolean;
  icon?: ReactNode;
  t?: T;
}

/**
 * Decimal entry.
 *
 * Keystrokes are held as a string so a half-typed "2." or a leading "0" survives
 * — parsing to a number on every keystroke fights the caret. inputMode="decimal"
 * raises the numeric keypad without type="number"'s spinner and validation
 * quirks.
 */
export function NumField({
  label,
  value,
  onChange,
  unit,
  required,
  optional,
  hint,
  error,
  integer,
  placeholder,
  mini,
  icon,
  t,
}: NumFieldProps) {
  const [text, setText] = useState(() => (value ? String(value) : ''));
  const focused = useRef(false);

  // Adopt programmatic changes (a reset, or a value the parent corrected) but
  // never overwrite what the user is actively typing.
  useEffect(() => {
    if (focused.current) return;
    const asNumber = parseFloat(text);
    const same = Number.isFinite(asNumber) ? asNumber === value : value === 0;
    if (!same) setText(value ? String(value) : '');
  }, [value, text]);

  const handle = (raw: string) => {
    // Accept a comma as a decimal point — many keypads here show one.
    let next = raw.replace(',', '.');
    next = integer ? next.replace(/[^\d]/g, '') : next.replace(/[^\d.]/g, '');

    // Collapse a second decimal point rather than rejecting the keystroke.
    const firstDot = next.indexOf('.');
    if (firstDot !== -1) {
      next = next.slice(0, firstDot + 1) + next.slice(firstDot + 1).replace(/\./g, '');
    }

    setText(next);
    const parsed = parseFloat(next);
    onChange(Number.isFinite(parsed) ? parsed : 0);
  };

  return (
    <div className={`field${mini ? ' mini' : ''}`}>
      <FieldLabel label={label} required={required} optional={optional} unit={unit} t={t} />
      <div className={`control mono${error ? ' invalid' : ''}`}>
        {icon}
        <input
          value={text}
          onChange={(event) => handle(event.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            // Normalise "2." / "" on the way out so what's stored is honest.
            const parsed = parseFloat(text);
            setText(Number.isFinite(parsed) ? String(parsed) : '');
          }}
          inputMode={integer ? 'numeric' : 'decimal'}
          enterKeyHint="next"
          placeholder={placeholder ?? '0'}
          autoComplete="off"
        />
      </div>
      <FieldFoot error={error} hint={hint} />
    </div>
  );
}

// ------------------------------------------------------------------- text

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  placeholder?: string;
  /** Digits only — the backend also enforces. */
  digitsOnly?: boolean;
  /** Custom character filter, applied on every keystroke (e.g. junction /
   *  chainage: digits, decimal point and brackets). Takes precedence over
   *  digitsOnly. */
  sanitize?: (raw: string) => string;
  multiline?: boolean;
  maxLength?: number;
  mini?: boolean;
  icon?: ReactNode;
  t?: T;
}

export function TextField({
  label,
  value,
  onChange,
  required,
  optional,
  hint,
  error,
  placeholder,
  digitsOnly,
  sanitize,
  multiline,
  maxLength,
  mini,
  icon,
  t,
}: TextFieldProps) {
  const handle = (raw: string) =>
    onChange(sanitize ? sanitize(raw) : digitsOnly ? raw.replace(/\D/g, '') : raw);

  return (
    <div className={`field${mini ? ' mini' : ''}`}>
      <FieldLabel label={label} required={required} optional={optional} t={t} />
      <div
        className={[
          'control',
          digitsOnly ? 'mono' : '',
          multiline ? 'area' : '',
          error ? 'invalid' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {icon}
        {multiline ? (
          <textarea
            value={value}
            placeholder={placeholder}
            maxLength={maxLength}
            rows={3}
            autoComplete="off"
            onChange={(event) => handle(event.target.value)}
          />
        ) : (
          <input
            value={value}
            placeholder={placeholder}
            maxLength={maxLength}
            autoComplete="off"
            inputMode={digitsOnly ? 'numeric' : 'text'}
            enterKeyHint="next"
            onChange={(event) => handle(event.target.value)}
          />
        )}
      </div>
      <FieldFoot error={error} hint={hint} />
    </div>
  );
}

// ------------------------------------------------------------------- date

interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | null;
  hint?: string;
  max?: string;
  t: T;
}

/**
 * Date entry.
 *
 * Uses the platform date picker — the one native control that beats anything
 * hand-rolled (correct locale, calendar and keyboard). The visible text is
 * re-rendered as dd-mm-yyyy on top, because the browser's own display format
 * follows the device locale and users here read day first.
 */
export function DateField({
  label,
  value,
  onChange,
  required,
  error,
  hint,
  max,
  t,
}: DateFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    tapLight();
    const input = inputRef.current;
    if (!input) return;
    if ('showPicker' in input && typeof input.showPicker === 'function') {
      try {
        input.showPicker();
        return;
      } catch {
        /* fall through to focus */
      }
    }
    input.focus();
    input.click();
  };

  return (
    <div className="field">
      <FieldLabel label={label} required={required} />
      <div
        className={`control mono tap${error ? ' invalid' : ''}`}
        onClick={openPicker}
        style={{ position: 'relative' }}
      >
        <IconCalendar />
        <span className={`val${value ? '' : ' empty'}`} style={{ fontFamily: 'var(--font-mono)' }}>
          {value ? fmtDate(value) : t('select')}
        </span>
        <input
          ref={inputRef}
          type="date"
          value={value}
          max={max}
          onChange={(event) => onChange(event.target.value)}
          // Kept in the layout (not display:none) so showPicker() has a real
          // anchor, but visually collapsed behind the styled row.
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
        />
      </div>
      <FieldFoot error={error} hint={hint} />
    </div>
  );
}

// ----------------------------------------------------------------- switch

export function Toggle({
  label,
  sub,
  on,
  onChange,
}: {
  label: string;
  sub?: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div
      className="tgl"
      onClick={() => {
        tapLight();
        onChange(!on);
      }}
      role="switch"
      aria-checked={on}
    >
      <div className="tl">
        {label}
        {sub ? <span className="ts">{sub}</span> : null}
      </div>
      <button type="button" className={`switch${on ? ' on' : ''}`} aria-hidden="true" tabIndex={-1} />
    </div>
  );
}

// ---------------------------------------------------------------- readout

interface ReadoutProps {
  label: string;
  value: number;
  precision?: number;
  hint?: string;
  mini?: boolean;
  /** Flag negatives in red — a negative soil figure means the sub-quantities
   *  exceed the trench and needs looking at. */
  warnNegative?: boolean;
}

/** A calculated, non-editable quantity. */
export function Readout({
  label,
  value,
  precision = 3,
  hint,
  mini = true,
  warnNegative,
}: ReadoutProps) {
  const negative = warnNegative && value < 0;
  return (
    <div className={`field${mini ? ' mini' : ''}`}>
      <FieldLabel label={label} />
      <div className={`control ro${negative ? ' neg' : ''}`}>
        <span className="roval">{fmt(value, precision)}</span>
      </div>
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}
