import { useMemo, useRef, useState } from 'react';
import { fmtQty, Grid, KIND_LABELS, Notice, toDateInput, useData } from '../lib.jsx';

function startOfWeek() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export default function Reports() {
  const grid = useRef();
  const [from, setFrom] = useState(toDateInput(startOfWeek()));
  const [to, setTo] = useState(toDateInput());
  const params = new URLSearchParams({
    from: new Date(`${from}T00:00`).toISOString(),
    to: new Date(new Date(`${to}T00:00`).getTime() + 86400000).toISOString(),
  });
  const { data, error } = useData(`/reports/production?${params}`);

  const columns = useMemo(
    () => [
      { field: 'kind', headerName: 'Step', width: 100, valueFormatter: (p) => KIND_LABELS[p.value], rowGroup: false },
      { field: 'machine', width: 160 },
      { field: 'name', headerName: 'Output', flex: 2, minWidth: 220 },
      { field: 'runs', width: 90, type: 'numericColumn' },
      { field: 'output_qty', headerName: 'Output qty', width: 130, type: 'numericColumn', valueFormatter: (p) => `${fmtQty(p.value)} ${p.data.unit}` },
      {
        headerName: 'Cases',
        width: 100,
        type: 'numericColumn',
        valueGetter: (p) => (p.data.units_per_case ? p.data.output_qty / p.data.units_per_case : null),
        valueFormatter: (p) => fmtQty(p.value, 1),
      },
      { field: 'input_lbs', headerName: 'Coffee used (lb)', width: 150, type: 'numericColumn', valueFormatter: (p) => fmtQty(p.value) },
      {
        headerName: 'Roast yield',
        width: 120,
        type: 'numericColumn',
        valueGetter: (p) => (p.data.kind === 'roast' && p.data.input_lbs ? (p.data.output_qty / p.data.input_lbs) * 100 : null),
        valueFormatter: (p) => (p.value === null ? '' : `${fmtQty(p.value, 1)}%`),
      },
    ],
    [],
  );

  const totals = useMemo(() => {
    const t = { roast: 0, pack: 0 };
    for (const r of data || []) {
      if (r.kind === 'roast' && r.unit === 'lb') t.roast += r.output_qty;
      if (r.kind === 'pack') t.pack += r.output_qty;
    }
    return t;
  }, [data]);

  return (
    <section>
      <div className="toolbar">
        <h2>Production</h2>
        <label className="inline">
          From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="inline">
          To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="spacer" />
        <button onClick={() => grid.current?.api.exportDataAsCsv({ fileName: `production-${from}-to-${to}.csv` })}>Export CSV</button>
      </div>
      <div className="stats">
        <div>
          <b>{fmtQty(totals.roast, 0)} lb</b>
          <span>roasted</span>
        </div>
        <div>
          <b>{fmtQty(totals.pack, 0)}</b>
          <span>units packed</span>
        </div>
      </div>
      <Notice kind="error">{error}</Notice>
      <Grid ref={grid} rowData={data || []} columnDefs={columns} height="calc(100vh - 320px)" />
    </section>
  );
}
