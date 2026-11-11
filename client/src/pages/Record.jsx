import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fmtQty, ItemSelect, Notice, Tabs, toLocalInput, useCan, useData, useUser } from '../lib.jsx';

// What the form asks for on each kind of entry. Mirrors server/src/rules.js.
const KINDS = {
  receive: {
    label: 'Receive',
    help: 'Deliveries in: green coffee, packaging, anything bought.',
    mode: 'simple',
    sign: 1,
    lineLabel: 'Received',
    types: null,
  },
  roast: {
    label: 'Roast',
    help: 'Green coffee in, roasted coffee out. Inputs fill in from the recipe; enter the real weights.',
    mode: 'production',
    machine: 'roaster',
    outTypes: ['roasted', 'blend'],
    inTypes: ['green', 'blend'],
    outLabel: 'Roasted coffee made',
  },
  blend: {
    label: 'Blend',
    help: 'Combine green or roasted coffees into a blend.',
    mode: 'production',
    machine: null,
    outTypes: ['blend'],
    inTypes: ['green', 'roasted', 'blend'],
    outLabel: 'Blend made',
  },
  pack: {
    label: 'Pack',
    help: 'Coffee + bags/labels/cases in, finished units out. Pick the packaging machine.',
    mode: 'production',
    machine: 'packer',
    outTypes: ['finished'],
    inTypes: ['roasted', 'blend', 'green', 'packaging', 'other'],
    outLabel: 'Units packed',
  },
  ship: {
    label: 'Ship',
    help: 'Product leaving the building.',
    mode: 'simple',
    sign: -1,
    lineLabel: 'Shipped',
    types: null,
  },
  adjust: {
    label: 'Adjust',
    help: 'Corrections: damage, samples, write-offs, found stock. For full shelf counts use Stock → Stock count.',
    mode: 'adjust',
  },
};

const emptyLine = () => ({ key: crypto.randomUUID(), item_id: null, qty: '', lot_code: '', sign: -1 });

// Only the kinds of entry this person's role allows are offered. Everyone can still look at Activity.
export default function Record() {
  const can = useCan();
  const user = useUser();
  const allowed = Object.keys(KINDS).filter((k) => can(k));
  if (allowed.length === 0) {
    return (
      <div className="narrow">
        <h2>Record</h2>
        <p className="muted">
          Your role ({user.role_name}) can look at stock, activity and reports but can't record entries. Ask an admin if you need to.
        </p>
      </div>
    );
  }
  // key: start over if an admin changes what this role can do while the page is open
  return <RecordForm key={allowed.join()} allowedKinds={allowed} />;
}

function RecordForm({ allowedKinds }) {
  const items = useData('/items');
  const machines = useData('/machines');
  const stock = useData('/stock');
  const [kind, setKind] = useState(allowedKinds.includes('roast') ? 'roast' : allowedKinds[0]);
  const cfg = KINDS[kind];

  const [when, setWhen] = useState(toLocalInput());
  const [machineId, setMachineId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [output, setOutput] = useState({ item_id: null, qty: '', lot_code: '' });
  const [lines, setLines] = useState([emptyLine()]);
  const [inputsTouched, setInputsTouched] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const onHand = useMemo(() => new Map((stock.data || []).map((s) => [s.id, s])), [stock.data]);
  const byId = useMemo(() => new Map((items.data || []).map((i) => [i.id, i])), [items.data]);
  const machineOptions = (machines.data || []).filter((m) => m.active && (!cfg.machine || m.kind === cfg.machine));

  function reset(nextKind = kind) {
    setOutput({ item_id: null, qty: '', lot_code: '' });
    setLines([emptyLine()]);
    setInputsTouched(false);
    setReference('');
    setNotes('');
    setWhen(toLocalInput());
    if (KINDS[nextKind].machine !== KINDS[kind].machine) setMachineId('');
  }

  // Fill inputs from the output item's recipe whenever output/qty change,
  // unless the user has already edited the inputs by hand.
  const previewSeq = useRef(0);
  async function fillFromRecipe(force = false) {
    if (cfg.mode !== 'production' || !output.item_id || !(Number(output.qty) > 0)) return;
    if (inputsTouched && !force) return;
    const seq = ++previewSeq.current;
    try {
      const p = await api('/movements/preview', { method: 'POST', body: { item_id: output.item_id, qty: Number(output.qty) } });
      if (seq !== previewSeq.current) return;
      const inputs = p.lines.filter((l) => l.qty < 0);
      setLines(inputs.length ? inputs.map((l) => ({ ...emptyLine(), item_id: l.item_id, qty: String(-l.qty) })) : [emptyLine()]);
      setInputsTouched(false);
      if (!p.has_recipe) setNotice({ kind: 'info', text: 'This item has no recipe yet, so enter inputs by hand (or add one under Catalog → Recipes).' });
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
    }
  }
  useEffect(() => {
    const t = setTimeout(() => fillFromRecipe(false), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output.item_id, output.qty, kind]);

  function updateLine(key, patch) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setInputsTouched(true);
  }

  async function submit(e) {
    e.preventDefault();
    setNotice(null);
    const body = {
      kind,
      occurred_at: new Date(when).toISOString(),
      machine_id: machineId || null,
      reference,
      notes,
      lines: [],
    };
    const filled = lines.filter((l) => l.item_id && l.qty !== '');
    if (cfg.mode === 'production') {
      body.lines.push({ item_id: output.item_id, qty: Number(output.qty), lot_code: output.lot_code });
      filled.forEach((l) => body.lines.push({ item_id: l.item_id, qty: -Math.abs(Number(l.qty)), lot_code: l.lot_code }));
    } else if (cfg.mode === 'simple') {
      filled.forEach((l) => body.lines.push({ item_id: l.item_id, qty: cfg.sign * Math.abs(Number(l.qty)), lot_code: l.lot_code }));
    } else {
      filled.forEach((l) => body.lines.push({ item_id: l.item_id, qty: l.sign * Math.abs(Number(l.qty)), lot_code: l.lot_code }));
    }
    setBusy(true);
    try {
      const r = await api('/movements', { method: 'POST', body });
      setNotice({
        kind: r.warnings.length ? 'warn' : 'success',
        text: (
          <>
            Saved {cfg.label.toLowerCase()} entry.
            {r.warnings.map((w) => (
              <div key={w}>⚠ {w}. Check the count or record a missing receipt.</div>
            ))}
          </>
        ),
      });
      reset();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const outItem = byId.get(output.item_id);
  const coffeeIn = lines.reduce((s, l) => s + (byId.get(l.item_id)?.unit === 'lb' ? Number(l.qty) || 0 : 0), 0);

  return (
    <div className="narrow wide">
      <h2>Record</h2>
      <Tabs
        value={kind}
        onChange={(k) => {
          reset(k);
          setKind(k);
          setNotice(null);
        }}
        options={Object.entries(KINDS)
          .filter(([k]) => allowedKinds.includes(k))
          .map(([k, v]) => [k, v.label])}
      />
      <p className="muted">{cfg.help}</p>
      <form className="card stack" onSubmit={submit}>
        <div className="row">
          <label>
            Date &amp; time
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </label>
          {cfg.mode === 'production' && (
            <label>
              Machine{cfg.machine === null ? ' (optional)' : ''}
              <select value={machineId} onChange={(e) => setMachineId(e.target.value)} required={cfg.machine === 'packer'}>
                <option value="">{cfg.machine === null ? 'None' : 'Choose machine…'}</option>
                {machineOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Reference <span className="muted">(PO, order, batch #)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>

        {cfg.mode === 'production' && (
          <fieldset>
            <legend>{cfg.outLabel}</legend>
            <div className="line">
              <ItemSelect
                items={items.data}
                types={cfg.outTypes}
                value={output.item_id}
                onChange={(v) => setOutput((o) => ({ ...o, item_id: v }))}
                required
              />
              <input
                type="number"
                step="any"
                min="0"
                placeholder={outItem ? `Qty (${outItem.unit})` : 'Qty'}
                value={output.qty}
                onChange={(e) => setOutput((o) => ({ ...o, qty: e.target.value }))}
                required
              />
              <input placeholder="Lot code (optional)" value={output.lot_code} onChange={(e) => setOutput((o) => ({ ...o, lot_code: e.target.value }))} />
              <span className="muted small">
                {outItem?.units_per_case && Number(output.qty) > 0 && `${fmtQty(Number(output.qty) / outItem.units_per_case, 1)} cases`}
                {kind === 'roast' && coffeeIn > 0 && Number(output.qty) > 0 && `Yield ${fmtQty((Number(output.qty) / coffeeIn) * 100, 1)}%`}
              </span>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>
            {cfg.mode === 'production' ? 'Used' : cfg.mode === 'simple' ? cfg.lineLabel : 'Changes'}
            {cfg.mode === 'production' && (
              <button type="button" className="link small" onClick={() => fillFromRecipe(true)} disabled={!output.item_id || !output.qty}>
                ↻ refill from recipe
              </button>
            )}
          </legend>
          {lines.map((l) => {
            const it = byId.get(l.item_id);
            const have = onHand.get(l.item_id)?.on_hand;
            return (
              <div className="line" key={l.key}>
                {cfg.mode === 'adjust' && (
                  <select value={l.sign} onChange={(e) => updateLine(l.key, { sign: Number(e.target.value) })} className="sign">
                    <option value={-1}>− Remove</option>
                    <option value={1}>+ Add</option>
                  </select>
                )}
                <ItemSelect items={items.data} types={cfg.mode === 'production' ? cfg.inTypes : null} value={l.item_id} onChange={(v) => updateLine(l.key, { item_id: v })} />
                <input type="number" step="any" min="0" placeholder={it ? `Qty (${it.unit})` : 'Qty'} value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} />
                <input placeholder="Lot code" value={l.lot_code} onChange={(e) => updateLine(l.key, { lot_code: e.target.value })} />
                <span className={`small ${have !== undefined && cfg.mode !== 'simple' && have < Number(l.qty) ? 'neg' : 'muted'}`}>
                  {have !== undefined && `on hand ${fmtQty(have)} ${it?.unit ?? ''}`}
                </span>
                <button type="button" className="link" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [emptyLine()]))} aria-label="Remove line">
                  ✕
                </button>
              </div>
            );
          })}
          <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            + Add line
          </button>
        </fieldset>

        <label>
          Notes
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="row end">
          <button type="button" onClick={() => reset()}>
            Clear
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : `Save ${cfg.label.toLowerCase()}`}
          </button>
        </div>
        <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
          {notice?.text}
        </Notice>
      </form>
    </div>
  );
}
