// Core inventory operations shared by routes, CSV import and dev seed data.
import { audit } from './audit.js';
import { badRequest, HttpError, isUuid, number, oneOf, round4, text, uuid } from './http.js';
import { KINDS, validateMovement } from './rules.js';

export async function onHandFor(q, itemIds) {
  if (itemIds.length === 0) return new Map();
  const { rows } = await q.query(
    `SELECT l.item_id, SUM(l.qty)::float8 AS on_hand
       FROM movement_lines l JOIN movements m ON m.id = l.movement_id
      WHERE m.voided_at IS NULL AND l.item_id = ANY($1::uuid[])
      GROUP BY l.item_id`,
    [itemIds],
  );
  const map = new Map(itemIds.map((id) => [id, 0]));
  for (const r of rows) map.set(r.item_id, round4(r.on_hand));
  return map;
}

async function loadItems(q, ids) {
  const { rows } = await q.query(
    'SELECT id, code, name, type, unit, active FROM items WHERE id = ANY($1::uuid[])',
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

function parseOccurredAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw badRequest('Date/time is not valid');
  if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw badRequest('Date/time is in the future');
  return d;
}

/** Records a movement. `q` should be a transaction. Returns { id, warnings }. */
export async function createMovement(q, user, input) {
  const kind = oneOf(input.kind, 'kind', KINDS);
  if (!Array.isArray(input.lines)) throw badRequest('lines must be a list');
  if (input.lines.length > 200) throw badRequest('Too many lines');

  const lines = input.lines.map((l, i) => ({
    item_id: isUuid(l?.item_id) ? l.item_id : null,
    qty: round4(Number(l?.qty)),
    lot_code: text(l?.lot_code, `Line ${i + 1} lot code`, { max: 100 }),
  }));
  const ids = [...new Set(lines.map((l) => l.item_id).filter(Boolean))];
  const items = await loadItems(q, ids);

  const errors = validateMovement({ kind, lines }, items);
  if (errors.length) throw badRequest(errors.join('. '));

  const machineId = uuid(input.machine_id, 'machine', { required: false });
  if (machineId) {
    const { rows } = await q.query('SELECT 1 FROM machines WHERE id = $1', [machineId]);
    if (!rows[0]) throw badRequest('Unknown machine');
  }

  const { rows } = await q.query(
    `INSERT INTO movements (kind, occurred_at, machine_id, reference, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      kind,
      parseOccurredAt(input.occurred_at),
      machineId,
      text(input.reference, 'reference', { max: 200 }),
      text(input.notes, 'notes', { max: 2000 }),
      user?.id ?? null,
    ],
  );
  const id = rows[0].id;
  for (const l of lines) {
    await q.query('INSERT INTO movement_lines (movement_id, item_id, lot_code, qty) VALUES ($1, $2, $3, $4)', [
      id,
      l.item_id,
      l.lot_code,
      l.qty,
    ]);
  }
  await audit(q, user, 'create', 'movement', id, { kind, lines: lines.length });

  // Warn (but allow) when something goes negative: the floor is always right,
  // and the count can be fixed later with an adjustment.
  const removed = [...new Set(lines.filter((l) => l.qty < 0).map((l) => l.item_id))];
  const after = await onHandFor(q, removed);
  const warnings = removed
    .filter((itemId) => after.get(itemId) < 0)
    .map((itemId) => {
      const it = items.get(itemId);
      return `${it.name} is now at ${after.get(itemId)} ${it.unit}`;
    });
  return { id, warnings };
}

/** Expands a recipe: "make qty of item" -> output line + input lines with current stock. */
export async function previewMovement(q, input) {
  const itemId = uuid(input.item_id, 'item');
  const qty = number(input.qty, 'quantity', { required: true });
  if (qty <= 0) throw badRequest('quantity must be more than 0');

  const { rows: parent } = await q.query('SELECT id, code, name, type, unit FROM items WHERE id = $1', [itemId]);
  if (!parent[0]) throw new HttpError(404, 'Item not found');

  const { rows: comps } = await q.query(
    `SELECT i.id, i.code, i.name, i.type, i.unit, c.qty_per_unit::float8 AS qty_per_unit
       FROM components c JOIN items i ON i.id = c.component_item_id
      WHERE c.parent_item_id = $1 ORDER BY (i.type IN ('packaging', 'other')), i.name`,
    [itemId],
  );
  const lines = [
    { item_id: parent[0].id, code: parent[0].code, name: parent[0].name, type: parent[0].type, unit: parent[0].unit, qty },
    ...comps.map((c) => ({
      item_id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      unit: c.unit,
      qty: -round4(c.qty_per_unit * qty),
    })),
  ];
  const onHand = await onHandFor(q, lines.map((l) => l.item_id));
  return { lines: lines.map((l) => ({ ...l, on_hand: onHand.get(l.item_id) })), has_recipe: comps.length > 0 };
}

/** Physical count: records an adjustment for the difference between counted and on-hand. */
export async function recordCount(q, user, { counts, notes, reference }) {
  if (!Array.isArray(counts) || counts.length === 0) throw badRequest('Nothing was counted');
  const clean = counts.map((c, i) => ({
    item_id: uuid(c?.item_id, `Count ${i + 1} item`),
    counted: number(c?.counted, `Count ${i + 1} quantity`, { required: true }),
  }));
  const onHand = await onHandFor(q, [...new Set(clean.map((c) => c.item_id))]);
  const lines = clean
    .map((c) => ({ item_id: c.item_id, qty: round4(c.counted - onHand.get(c.item_id)) }))
    .filter((l) => l.qty !== 0);
  if (lines.length === 0) return { id: null, changed: 0, warnings: [] };
  const result = await createMovement(q, user, {
    kind: 'adjust',
    reference: reference || 'Stock count',
    notes,
    lines,
  });
  return { ...result, changed: lines.length };
}
