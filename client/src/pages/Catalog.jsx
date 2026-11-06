import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { fmtQty, Grid, ItemSelect, Notice, Tabs, TYPE_LABELS, TYPES, useData } from '../lib.jsx';

export default function Catalog() {
  const [tab, setTab] = useState('items');
  return (
    <section>
      <div className="toolbar">
        <h2>Catalog</h2>
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            ['items', 'Items'],
            ['recipes', 'Recipes'],
            ['machines', 'Machines'],
          ]}
        />
      </div>
      {tab === 'items' && <Items />}
      {tab === 'recipes' && <Recipes />}
      {tab === 'machines' && <Machines />}
    </section>
  );
}

// Spreadsheet-style editing: change a cell, it saves. Errors undo the cell.
function saveCell(path, setNotice) {
  return async (e) => {
    if (e.newValue === e.oldValue) return;
    const field = e.colDef.field;
    let value = e.newValue;
    if (value === '' || value === undefined) value = null;
    try {
      await api(`${path}/${e.data.id}`, { method: 'PATCH', body: { [field]: value } });
      setNotice(null);
    } catch (err) {
      e.node.setDataValue(field, e.oldValue);
      setNotice({ kind: 'error', text: err.message });
    }
  };
}

function Items() {
  const { data, error } = useData('/items');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState({ code: '', name: '', type: 'green', unit: 'lb' });
  const [showInactive, setShowInactive] = useState(false);

  const columns = useMemo(
    () => [
      { field: 'code', width: 170, editable: true, pinned: 'left' },
      { field: 'name', flex: 2, minWidth: 220, editable: true },
      {
        field: 'type',
        width: 140,
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: { values: TYPES },
        valueFormatter: (p) => TYPE_LABELS[p.value] ?? p.value,
      },
      { field: 'unit', width: 90, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['lb', 'kg', 'oz', 'each', 'case', 'roll', 'box'] } },
      { field: 'pack_size_oz', headerName: 'Pack oz', width: 100, editable: true, cellDataType: 'number' },
      { field: 'units_per_case', headerName: 'Units/case', width: 110, editable: true, cellDataType: 'number' },
      { field: 'reorder_point', headerName: 'Reorder at', width: 115, editable: true, cellDataType: 'number' },
      { field: 'supplier', width: 140, editable: true },
      { field: 'sage_item_code', headerName: 'Sage code', width: 120, editable: true },
      { field: 'notes', flex: 1, minWidth: 160, editable: true },
      { field: 'active', width: 90, editable: true, cellDataType: 'boolean' },
    ],
    [],
  );

  async function add(e) {
    e.preventDefault();
    try {
      await api('/items', { method: 'POST', body: draft });
      setDraft((d) => ({ ...d, code: '', name: '' }));
      setNotice({ kind: 'success', text: `Added ${draft.name}.` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }

  return (
    <>
      <form className="toolbar card tight" onSubmit={add}>
        <b>New item</b>
        <input placeholder="Code (e.g. GRN-BRA-CER)" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} required />
        <input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required className="grow" />
        <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value, unit: ['packaging', 'finished'].includes(e.target.value) ? 'each' : 'lb' })}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
          {['lb', 'kg', 'oz', 'each', 'case', 'roll', 'box'].map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <button className="primary">Add</button>
      </form>
      <div className="toolbar">
        <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="inline">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <span className="muted small">Click a cell to edit; changes save immediately. Retire items by unticking “active”.</span>
      </div>
      <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
        {notice?.text}
      </Notice>
      <Notice kind="error">{error}</Notice>
      <Grid
        rowData={(data || []).filter((i) => showInactive || i.active)}
        columnDefs={columns}
        quickFilterText={search}
        onCellValueChanged={saveCell('/items', setNotice)}
        height="calc(100vh - 340px)"
      />
    </>
  );
}

const RECIPE_HINTS = {
  roasted: 'How many lb of green per 1 lb roasted? (e.g. 1.19 for ~16% roast loss)',
  blend: 'Fraction of each coffee per 1 lb of blend. These should add up to 1.',
  finished: 'What one packed unit uses: lb of coffee (e.g. 0.75 for 12 oz), 1 bag, 1 label, 1/12 case…',
};

function Recipes() {
  const { data: items } = useData('/items');
  const [parentId, setParentId] = useState(null);
  const [rows, setRows] = useState([]);
  const [notice, setNotice] = useState(null);
  const parent = (items || []).find((i) => i.id === parentId);

  useEffect(() => {
    if (!parent) return;
    setRows(parent.components.map((c) => ({ ...c, key: crypto.randomUUID(), qty_per_unit: String(c.qty_per_unit) })));
    // Only reload when switching items, not on every live refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, !!parent]);

  const byId = new Map((items || []).map((i) => [i.id, i]));
  const total = rows.reduce((s, r) => s + (byId.get(r.component_item_id)?.unit === 'lb' ? Number(r.qty_per_unit) || 0 : 0), 0);
  const withRecipes = (items || []).filter((i) => ['roasted', 'blend', 'finished'].includes(i.type) && i.active);

  async function save() {
    try {
      await api(`/items/${parentId}/components`, {
        method: 'PUT',
        body: {
          components: rows
            .filter((r) => r.component_item_id && r.qty_per_unit !== '')
            .map((r) => ({ component_item_id: r.component_item_id, qty_per_unit: Number(r.qty_per_unit) })),
        },
      });
      setNotice({ kind: 'success', text: 'Recipe saved.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }

  return (
    <div className="split">
      <aside className="list">
        {['roasted', 'blend', 'finished'].map((t) => (
          <div key={t}>
            <h4>{TYPE_LABELS[t]}</h4>
            {withRecipes
              .filter((i) => i.type === t)
              .map((i) => (
                <button key={i.id} className={`list-item ${i.id === parentId ? 'active' : ''}`} onClick={() => (setParentId(i.id), setNotice(null))}>
                  {i.name}
                  {!i.components.length && <span className="muted small"> · no recipe</span>}
                </button>
              ))}
          </div>
        ))}
      </aside>
      <section className="grow">
        {!parent ? (
          <p className="muted">
            Pick an item to edit its recipe. Recipes pre-fill the inputs when someone records a roast, blend or packing run.
          </p>
        ) : (
          <div className="card stack">
            <h3>
              1 {parent.unit} of {parent.name} uses:
            </h3>
            <p className="muted small">{RECIPE_HINTS[parent.type]}</p>
            {rows.map((r) => {
              const it = byId.get(r.component_item_id);
              return (
                <div className="line" key={r.key}>
                  <ItemSelect
                    items={items}
                    types={TYPES.filter((t) => t !== 'finished')}
                    value={r.component_item_id}
                    onChange={(v) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, component_item_id: v } : x)))}
                  />
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={r.qty_per_unit}
                    placeholder="Qty"
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, qty_per_unit: e.target.value } : x)))}
                  />
                  <span className="muted small">{it?.unit}</span>
                  <button className="link" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove">
                    ✕
                  </button>
                </div>
              );
            })}
            <div className="row">
              <button onClick={() => setRows((rs) => [...rs, { key: crypto.randomUUID(), component_item_id: null, qty_per_unit: '' }])}>+ Add component</button>
              {parent.type === 'blend' && (
                <span className={Math.abs(total - 1) > 0.001 ? 'neg small' : 'muted small'}>Total: {fmtQty(total, 3)} lb per lb</span>
              )}
              {parent.type === 'finished' && parent.pack_size_oz && (
                <span className="muted small">
                  Pack size {parent.pack_size_oz} oz = {fmtQty(parent.pack_size_oz / 16, 4)} lb coffee
                </span>
              )}
              <div className="spacer" />
              <button className="primary" onClick={save}>
                Save recipe
              </button>
            </div>
            <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
              {notice?.text}
            </Notice>
          </div>
        )}
      </section>
    </div>
  );
}

function Machines() {
  const { data, error } = useData('/machines');
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState({ name: '', kind: 'packer' });
  const columns = useMemo(
    () => [
      { field: 'name', flex: 1, editable: true },
      { field: 'kind', width: 140, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: ['roaster', 'packer', 'other'] } },
      { field: 'notes', flex: 2, editable: true },
      { field: 'active', width: 100, editable: true, cellDataType: 'boolean' },
    ],
    [],
  );
  async function add(e) {
    e.preventDefault();
    try {
      await api('/machines', { method: 'POST', body: draft });
      setDraft({ name: '', kind: draft.kind });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  }
  return (
    <>
      <form className="toolbar card tight" onSubmit={add}>
        <b>New machine</b>
        <input placeholder="Name (e.g. Packer C)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
          <option value="roaster">Roaster</option>
          <option value="packer">Packer</option>
          <option value="other">Other</option>
        </select>
        <button className="primary">Add</button>
      </form>
      <Notice kind={notice?.kind} onClose={() => setNotice(null)}>
        {notice?.text}
      </Notice>
      <Notice kind="error">{error}</Notice>
      <Grid rowData={data || []} columnDefs={columns} onCellValueChanged={saveCell('/machines', setNotice)} height="400px" />
    </>
  );
}
