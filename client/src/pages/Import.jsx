import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { api } from '../api.js';
import { Notice, useUser } from '../lib.jsx';

const TEMPLATE = `code,name,type,unit,on_hand,reorder_point,pack_size_oz,units_per_case,supplier,sage_item_code,notes
GRN-BRA-CER,Brazil Cerrado Natural (green),green,lb,2640,1000,,,Importer A,,
RST-BRA,Brazil Cerrado (roasted),roasted,lb,120,,,,,,
BLD-HOUSE,House Blend,blend,lb,300,,,,,,
PKG-BAG-12OZ,12 oz valve bag,packaging,each,5000,2000,,,,,
FG-HOUSE-12OZ-WB,House Blend 12 oz Whole Bean,finished,each,480,,12,12,,,
`;

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'items-template.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

export default function Import() {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function pick(e) {
    const f = e.target.files[0];
    setResult(null);
    setError(null);
    setFile(f);
    if (!f) return setRows(null);
    Papa.parse(f, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (r) => {
        if (r.errors.length) setError(`Row ${r.errors[0].row + 2}: ${r.errors[0].message}`);
        setRows(r.data);
      },
    });
  }

  async function submit() {
    setBusy(true);
    try {
      setResult(await api('/import/items', { method: 'POST', body: { rows } }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const cols = rows?.length ? Object.keys(rows[0]) : [];
  const hasOnHand = cols.some((c) => c.trim().toLowerCase() === 'on_hand');

  return (
    <div className="narrow wide">
      <SampleData />
      <h2>Import from spreadsheet</h2>
      <div className="card stack">
        <p>
          Save a tab of the current spreadsheet as CSV with these column headings, then upload it. Rows are matched by <b>code</b>: new
          codes create items, existing codes update them.
        </p>
        <ul className="small">
          <li>
            Required for new items: <code>code</code>, <code>name</code>, <code>type</code> (green, roasted, blend, packaging, finished,
            other)
          </li>
          <li>
            Optional: <code>unit</code>, <code>reorder_point</code>, <code>pack_size_oz</code>, <code>units_per_case</code>,{' '}
            <code>supplier</code>, <code>sage_item_code</code>, <code>notes</code>, <code>active</code>
          </li>
          <li>
            <code>on_hand</code>: sets stock to that number (recorded as one “Import count” adjustment). Leave blank to keep the current stock.
          </li>
        </ul>
        <div className="row">
          <input type="file" accept=".csv,text/csv" onChange={pick} />
          <button className="link" onClick={downloadTemplate}>
            Download template
          </button>
        </div>
        <Notice kind="error">{error}</Notice>
        {rows && (
          <>
            <p>
              <b>{rows.length}</b> rows in {file?.name}. Columns: {cols.join(', ')}.
              {hasOnHand && ' Stock levels will be set from on_hand.'}
            </p>
            <div className="table-scroll">
              <table className="mini">
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i}>
                      {cols.map((c) => (
                        <td key={c}>{r[c]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row end">
              <button className="primary" onClick={submit} disabled={busy || !!result}>
                {busy ? 'Importing…' : `Import ${rows.length} rows`}
              </button>
            </div>
          </>
        )}
        {result && (
          <Notice kind={result.errors.length ? 'warn' : 'success'}>
            Created {result.created}, updated {result.updated}, stock set on {result.counted} item(s).
            {result.errors.map((e) => (
              <div key={e.row}>
                Row {e.row}: {e.error}
              </div>
            ))}
          </Notice>
        )}
      </div>
    </div>
  );
}

// Practice copies only (staging and local): load or remove a realistic set of fake data.
function SampleData() {
  const user = useUser();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const refresh = () => api('/sample-data').then(setState, () => setState(null));
  useEffect(() => {
    if (user.role === 'admin') refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (user.role !== 'admin' || !state?.allowed) return null;

  async function run(method, confirmText, done) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api('/sample-data', { method, body: {} });
      setMsg({ kind: 'success', text: done(r) });
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className="card stack sample-card">
      <h3>Practice data</h3>
      <p className="small">
        Fill this practice copy with about two months of made-up roastery activity: green coffee deliveries, roasting, blends, packing on
        two packers, shipments, damaged bags and one voided mistake. Sample items have codes starting with <code>DEMO-</code>. This
        option doesn't exist on the real (production) app.
      </p>
      <div className="row">
        {!state.loaded ? (
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run('POST', 'Load about 300 sample entries and 33 sample items into this practice copy?', (r) =>
                `Loaded ${r.items} items, ${r.machines} machines and ${r.movements} entries. Have a look at Stock, Activity and Reports.`,
              )
            }
          >
            {busy ? 'Loading…' : 'Load sample data'}
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() =>
              run('DELETE', 'Remove all sample data (DEMO- items and their entries)? Your own practice entries stay.', (r) =>
                `Removed ${r.movements} entries and ${r.items} items${r.items_deactivated ? ` (${r.items_deactivated} kept but hidden because your own entries use them)` : ''}.`,
              )
            }
          >
            {busy ? 'Removing…' : 'Remove sample data'}
          </button>
        )}
      </div>
      <Notice kind={msg?.kind} onClose={() => setMsg(null)}>
        {msg?.text}
      </Notice>
    </div>
  );
}
