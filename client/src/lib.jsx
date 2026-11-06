import { createContext, forwardRef, useCallback, useContext, useEffect, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { api } from './api.js';

ModuleRegistry.registerModules([AllCommunityModule]);

// ---- live updates ----------------------------------------------------------
// `tick` goes up whenever anyone saves anything; pages refetch when it changes.
export const LiveContext = createContext({ tick: 0 });
export const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);

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
