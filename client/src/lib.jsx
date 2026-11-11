import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { api } from './api.js';

ModuleRegistry.registerModules([AllCommunityModule]);

// ---- live updates ----------------------------------------------------------
// `tick` goes up whenever anyone saves anything; pages refetch when it changes.
export const LiveContext = createContext({ tick: 0 });
export const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);
/** `can('ship')`: does this person's role allow it? (Everyone can always look; this is only about changing things.) */
export function useCan() {
  const user = useUser();
  return (permission) => Boolean(user?.permissions?.includes(permission));
}

/** The company logo if one was uploaded, otherwise the coffee cup. `logo` is the version number from /api/config. */
export function Brand({ logo }) {
  return (
    <>
      {logo ? <img className="brand-logo" src={`/api/branding/logo?v=${logo}`} alt="" /> : '☕ '}
      Roastery Ledger
    </>
  );
}

export function useData(path) {
  const { tick } = useContext(LiveContext);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    if (!path) return Promise.resolve();
    return api(path).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e) => setError(e.message),
    );
  }, [path]);
  useEffect(() => {
    load();
  }, [load, tick]);
  return { data, error, reload: load };
}

// ---- formatting -------------------------------------------------------------
export const TYPES = ['green', 'roasted', 'blend', 'packaging', 'finished', 'other'];
export const TYPE_LABELS = {
  green: 'Green coffee',
  roasted: 'Roasted coffee',
  blend: 'Blends',
  packaging: 'Packaging',
  finished: 'Finished goods',
  other: 'Other',
};
export const KIND_LABELS = {
  receive: 'Receive',
  roast: 'Roast',
  blend: 'Blend',
  pack: 'Pack',
  ship: 'Ship',
  adjust: 'Adjust',
};

export function fmtQty(n, digits = 2) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtDateTime(v) {
  if (!v) return '';
  return new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function toLocalInput(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function toDateInput(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function linesSummary(lines, sign) {
  return lines
    .filter((l) => (sign > 0 ? l.qty > 0 : l.qty < 0))
    .sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty))
    .map((l) => `${fmtQty(Math.abs(l.qty))} ${l.unit} ${l.name}${l.lot_code ? ` [${l.lot_code}]` : ''}`)
    .join('; ');
}

// ---- small UI pieces --------------------------------------------------------
const gridTheme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 14,
  accentColor: '#8a4b20',
  headerBackgroundColor: '#f5efe8',
  rowHeight: 36,
  headerHeight: 38,
  borderRadius: 6,
  wrapperBorderRadius: 8,
});

export const Grid = forwardRef(function Grid({ height = 'calc(100vh - 250px)', defaultColDef, ...props }, ref) {
  return (
    <div style={{ height, minHeight: 240 }}>
      <AgGridReact
        ref={ref}
        theme={gridTheme}
        defaultColDef={{ sortable: true, filter: true, resizable: true, ...defaultColDef }}
        getRowId={(p) => p.data.id ?? JSON.stringify(p.data)}
        stopEditingWhenCellsLoseFocus
        singleClickEdit
        {...props}
      />
    </div>
  );
});

export function Notice({ kind = 'info', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`notice notice-${kind}`}>
      <div>{children}</div>
      {onClose && (
        <button className="link" onClick={onClose} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

/** Native select of items grouped by type. `types` limits which types are offered. */
export function ItemSelect({ items, types, value, onChange, placeholder = 'Choose item…', ...rest }) {
  const groups = TYPES.filter((t) => !types || types.includes(t))
    .map((t) => [t, (items || []).filter((i) => i.type === t && (i.active || i.id === value))])
    .filter(([, list]) => list.length);
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || null)} {...rest}>
      <option value="">{placeholder}</option>
      {groups.map(([t, list]) => (
        <optgroup key={t} label={TYPE_LABELS[t]}>
          {list.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.code})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function Tabs({ value, onChange, options }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={value === key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

// In-page replacement for window.confirm / window.prompt, which some embedded
// browsers block (they silently answer "cancel"). Usage:
//   const [dialog, ask] = useDialog();
//   const ok = await ask({ title, message, confirmLabel });            // true / false
//   const text = await ask({ title, input: { label, type, minLength } }); // string / null
//   ...render {dialog} somewhere in the component.
export function useDialog() {
  const [state, setState] = useState(null);
  const ask = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (value) => {
    state?.resolve(value);
    setState(null);
  };
  const dialog = state ? <Dialog {...state} onClose={close} /> : null;
  return [dialog, ask];
}

function Dialog({ title, message, input, confirmLabel = 'Confirm', danger, onClose }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose(input ? null : false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [input, onClose]);
  const tooShort = input?.minLength && value.length < input.minLength;

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(input ? null : false)}>
      <form
        className="dialog card stack"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          if (input && (!value.trim() || tooShort)) return;
          onClose(input ? value : true);
        }}
      >
        <h3>{title}</h3>
        {message && <div className="dialog-message">{message}</div>}
        {input && (
          <label>
            {input.label}
            <input
              ref={ref}
              type={input.type ?? 'text'}
              autoComplete={input.type === 'password' ? 'new-password' : 'off'}
              placeholder={input.placeholder}
              minLength={input.minLength}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
            {tooShort && value.length > 0 && <span className="small muted">At least {input.minLength} characters</span>}
          </label>
        )}
        <div className="row end">
          <button type="button" onClick={() => onClose(input ? null : false)}>
            Cancel
          </button>
          <button ref={input ? undefined : ref} className={danger ? 'primary danger' : 'primary'} disabled={Boolean(input && (!value.trim() || tooShort))}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
