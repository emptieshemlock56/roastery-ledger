import { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtDateTime, fmtQty, Grid, KIND_LABELS, linesSummary, Notice, toDateInput, useCan, useData, useDialog } from '../lib.jsx';

export default function Activity() {
  const can = useCan();
  const grid = useRef();
  const [from, setFrom] = useState(toDateInput(new Date(Date.now() - 13 * 86400000)));
  const [to, setTo] = useState(toDateInput());
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialog, ask] = useDialog();

  const toExclusive = new Date(new Date(`${to}T00:00`).getTime() + 86400000).toISOString();
  const params = new URLSearchParams({ from: new Date(`${from}T00:00`).toISOString(), to: toExclusive, limit: '2000' });
  if (kind) params.set('kind', kind);
  const { data, error } = useData(`/movements?${params}`);

  const columns = useMemo(
    () => [
      { field: 'occurred_at', headerName: 'When', width: 150, sort: 'desc', valueFormatter: (p) => fmtDateTime(p.value) },
      { field: 'kind', headerName: 'Type', width: 95, valueFormatter: (p) => KIND_LABELS[p.value] },
      { field: 'machine_name', headerName: 'Machine', width: 140 },
      { headerName: 'In (made / received / added)', flex: 2, minWidth: 220, valueGetter: (p) => linesSummary(p.data.lines, 1), tooltipValueGetter: (p) => p.value },
      { headerName: 'Out (used / shipped / removed)', flex: 2, minWidth: 220, valueGetter: (p) => linesSummary(p.data.lines, -1), tooltipValueGetter: (p) => p.value },
      { field: 'reference', width: 130 },
      { field: 'created_by_name', headerName: 'By', width: 120 },
      {
        headerName: 'Status',
        width: 100,
        valueGetter: (p) => (p.data.voided_at ? 'Voided' : ''),
        cellClass: (p) => (p.value ? 'cell-bad' : ''),
      },
    ],
    [],
  );

  async function voidEntry() {
    const reason = await ask({
      title: 'Void this entry?',
      message: 'It stays in the history, crossed out, and stops counting toward stock.',
      input: { label: 'Why is it being voided?', placeholder: 'e.g. entered twice' },
      confirmLabel: 'Void entry',
      danger: true,
    });
    if (!reason) return;
    try {
      const updated = await api(`/movements/${selected.id}/void`, { method: 'POST', body: { reason } });
      setSelected(updated);
      setNotice({ kind: 'success', text: 'Entry voided. Stock has been recalculated.' });
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    }
  }

  return (
    <div className="split">
      {dialog}
      <section className="grow">
        <div className="toolbar">
          <h2>Activity</h2>
          <label className="inline">
            From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="inline">
            To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="spacer" />
          <button onClick={() => grid.current?.api.exportDataAsCsv({ fileName: `activity-${from}-to-${to}.csv` })}>Export CSV</button>
        </div>
        <Notice kind="error">{error}</Notice>
        <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
          {notice?.text}
        </Notice>
        <Grid
          ref={grid}
          rowData={data || []}
          columnDefs={columns}
          quickFilterText={search}
          tooltipShowDelay={300}
          rowClassRules={{ 'row-voided': (p) => !!p.data.voided_at }}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          onSelectionChanged={(e) => setSelected(e.api.getSelectedRows()[0] ?? null)}
        />
      </section>
      {selected && (
        <aside className="panel">
          <div className="panel-head">
            <div>
              <div className="muted small">{fmtDateTime(selected.occurred_at)}</div>
              <h3>
                {KIND_LABELS[selected.kind]}
                {selected.machine_name && ` · ${selected.machine_name}`}
              </h3>
            </div>
            <button className="link" onClick={() => setSelected(null)} aria-label="Close">
              ✕
            </button>
          </div>
          {selected.voided_at && (
            <Notice kind="error">
              Voided {fmtDateTime(selected.voided_at)} by {selected.voided_by_name}: {selected.void_reason}
            </Notice>
          )}
          <table className="mini">
            <thead>
              <tr>
                <th>Item</th>
                <th>Lot</th>
                <th className="num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {selected.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.name}</td>
                  <td>{l.lot_code}</td>
                  <td className={`num ${l.qty > 0 ? 'pos' : 'neg'}`}>
                    {l.qty > 0 ? '+' : ''}
                    {fmtQty(l.qty)} {l.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected.reference && <p>Reference: {selected.reference}</p>}
          {selected.notes && <p className="pre">{selected.notes}</p>}
          <p className="muted small">
            Entered by {selected.created_by_name || 'system'} on {fmtDateTime(selected.created_at)}
          </p>
          {!selected.voided_at && can('void') && can(selected.kind) && (
            <button className="danger" onClick={voidEntry}>
              Void this entry
            </button>
          )}
        </aside>
      )}
    </div>
  );
}
