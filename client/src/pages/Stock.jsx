import { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime, fmtQty, Grid, KIND_LABELS, linesSummary, Notice, TYPE_LABELS, TYPES, useData } from '../lib.jsx';

function status(row) {
  if (row.on_hand < 0) return 'Negative';
  if (row.reorder_point !== null && row.on_hand <= row.reorder_point) return 'Low';
  return '';
}

export default function Stock() {
  const { data, error } = useData('/stock');
  const grid = useRef();
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState({});
  const [notice, setNotice] = useState(null);

  const rows = useMemo(
    () => (data || []).filter((r) => type === 'all' || r.type === type).map((r) => ({ ...r, counted: counts[r.id] ?? null })),
    [data, type, counts],
  );

  const columns = useMemo(
    () => [
      { field: 'code', width: 170, pinned: 'left' },
      { field: 'name', flex: 2, minWidth: 220 },
      { field: 'type', width: 130, valueFormatter: (p) => TYPE_LABELS[p.value] ?? p.value },
      {
        field: 'on_hand',
        headerName: 'On hand',
        width: 130,
        type: 'numericColumn',
        valueFormatter: (p) => fmtQty(p.value),
        cellClass: (p) => ({ Negative: 'cell-bad', Low: 'cell-warn' })[status(p.data)] ?? '',
      },
      ...(counting
        ? [
            {
              field: 'counted',
              headerName: 'Counted ✎',
              width: 130,
              editable: true,
              cellDataType: 'number',
              cellClass: 'cell-editable',
              valueFormatter: (p) => fmtQty(p.value),
            },
          ]
        : []),
      { field: 'unit', width: 80 },
      {
        headerName: 'Cases',
        width: 100,
        type: 'numericColumn',
        valueGetter: (p) => (p.data.units_per_case ? p.data.on_hand / p.data.units_per_case : null),
        valueFormatter: (p) => fmtQty(p.value, 1),
      },
      { field: 'reorder_point', headerName: 'Reorder at', width: 120, type: 'numericColumn', valueFormatter: (p) => fmtQty(p.value) },
      { headerName: 'Status', width: 110, valueGetter: (p) => status(p.data), cellClass: (p) => (p.value ? 'cell-warn' : '') },
      { field: 'last_movement_at', headerName: 'Last change', width: 160, valueFormatter: (p) => fmtDateTime(p.value) },
    ],
    [counting],
  );

  async function saveCount() {
    const entries = Object.entries(counts).filter(([, v]) => v !== null && v !== '' && Number.isFinite(Number(v)));
    if (!entries.length) return setNotice({ kind: 'error', text: 'Type counted quantities in the "Counted" column first.' });
    try {
      const r = await api('/stock/count', {
        method: 'POST',
        body: { counts: entries.map(([item_id, counted]) => ({ item_id, counted: Number(counted) })) },
      });
      setNotice({ kind: 'success', text: r.changed ? `Count saved. ${r.changed} item(s) adjusted.` : 'Count saved. Everything matched.' });
      setCounts({});
      setCounting(false);
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    }
  }

  return (
    <div className="split">
      <section className="grow">
        <div className="toolbar">
          <h2>Stock on hand</h2>
          <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="spacer" />
          {counting ? (
            <>
              <button onClick={() => (setCounting(false), setCounts({}))}>Cancel count</button>
              <button className="primary" onClick={saveCount}>
                Save count
              </button>
            </>
          ) : (
            <button onClick={() => setCounting(true)} title="Enter physical counts; differences are recorded as adjustments">
              Stock count
            </button>
          )}
          <button onClick={() => grid.current?.api.exportDataAsCsv({ fileName: `stock-${new Date().toISOString().slice(0, 10)}.csv` })}>
            Export CSV
          </button>
        </div>
        <div className="chips">
          {['all', ...TYPES].map((t) => (
            <button key={t} className={type === t ? 'chip active' : 'chip'} onClick={() => setType(t)}>
              {t === 'all' ? 'All' : TYPE_LABELS[t]}
              {data && ` (${t === 'all' ? data.length : data.filter((r) => r.type === t).length})`}
            </button>
          ))}
        </div>
        <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
          {notice?.text}
        </Notice>
        <Notice kind="error">{error}</Notice>
        {counting && (
          <Notice kind="info">
            Count mode: type what is physically on the shelf in the <b>Counted</b> column. Blank rows are left alone. Saving records the
            differences as one adjustment.
          </Notice>
        )}
        <Grid
          ref={grid}
          rowData={rows}
          columnDefs={columns}
          quickFilterText={search}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          onSelectionChanged={(e) => setSelected(e.api.getSelectedRows()[0] ?? null)}
          onCellValueChanged={(e) => e.colDef.field === 'counted' && setCounts((c) => ({ ...c, [e.data.id]: e.newValue }))}
        />
      </section>
      {selected && <ItemPanel item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ItemPanel({ item, onClose }) {
  const lots = useData(`/stock/lots?item_id=${item.id}`);
  const history = useData(`/movements?item_id=${item.id}&limit=25&include_voided=false`);
  return (
    <aside className="panel">
      <div className="panel-head">
        <div>
          <div className="muted small">{item.code}</div>
          <h3>{item.name}</h3>
        </div>
        <button className="link" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="big">
        {fmtQty(item.on_hand)} <span className="muted">{item.unit}</span>
      </div>
      <h4>By lot</h4>
      {lots.data?.length ? (
        <table className="mini">
          <tbody>
            {lots.data.map((l) => (
              <tr key={l.lot_code}>
                <td>{l.lot_code || <span className="muted">(no lot)</span>}</td>
                <td className="num">{fmtQty(l.on_hand)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">No lot codes recorded.</p>
      )}
      <h4>Recent activity</h4>
      <ul className="history">
        {(history.data || []).map((m) => {
          const line = m.lines.filter((l) => l.item_id === item.id).reduce((s, l) => s + l.qty, 0);
          return (
            <li key={m.id}>
              <span className={line >= 0 ? 'pos' : 'neg'}>
                {line >= 0 ? '+' : ''}
                {fmtQty(line)}
              </span>{' '}
              {KIND_LABELS[m.kind]} · {fmtDateTime(m.occurred_at)}
              <div className="muted small">{m.kind === 'adjust' ? m.reference : linesSummary(m.lines, 1)}</div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
