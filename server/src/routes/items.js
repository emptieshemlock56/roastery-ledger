import { Router } from 'express';
import { audit } from '../audit.js';
import { badRequest, bool, HttpError, number, oneOf, text, uuid } from '../http.js';
import { ITEM_TYPES } from '../rules.js';

const SELECT_ITEMS = `
  SELECT i.id, i.code, i.name, i.type, i.unit, i.pack_size_oz::float8, i.units_per_case, i.supplier,
         i.sage_item_code, i.reorder_point::float8, i.notes, i.active, i.updated_at,
         COALESCE((SELECT json_agg(json_build_object(
                     'component_item_id', c.component_item_id,
                     'qty_per_unit', c.qty_per_unit::float8) ORDER BY c.qty_per_unit DESC)
                   FROM components c WHERE c.parent_item_id = i.id), '[]') AS components
    FROM items i`;

// Validates whichever editable fields are present in `body`.
export function parseItemFields(body, { partial }) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('code')) out.code = text(body.code, 'code', { required: true, max: 60 });
  if (!partial || has('name')) out.name = text(body.name, 'name', { required: true, max: 200 });
  if (!partial || has('type')) out.type = oneOf(body.type, 'type', ITEM_TYPES);
  if (!partial || has('unit')) out.unit = text(body.unit, 'unit', { max: 20 }) || 'lb';
  if (has('pack_size_oz')) out.pack_size_oz = number(body.pack_size_oz, 'pack size (oz)', { min: 0 });
  if (has('units_per_case')) out.units_per_case = number(body.units_per_case, 'units per case', { min: 1, integer: true });
  if (has('supplier')) out.supplier = text(body.supplier, 'supplier', { max: 200 });
  if (has('sage_item_code')) out.sage_item_code = text(body.sage_item_code, 'Sage item code', { max: 60 });
  if (has('reorder_point')) out.reorder_point = number(body.reorder_point, 'reorder point', { min: 0 });
  if (has('notes')) out.notes = text(body.notes, 'notes', { max: 2000 });
  if (has('active')) out.active = bool(body.active, 'active');
  return out;
}

export async function insertItem(q, fields) {
  const cols = Object.keys(fields);
  const { rows } = await q.query(
    `INSERT INTO items (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((c) => fields[c]),
  );
  return rows[0].id;
}

export async function updateItem(q, id, fields) {
  const cols = Object.keys(fields);
  if (cols.length === 0) return;
  const { rowCount } = await q.query(
    `UPDATE items SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
    [id, ...cols.map((c) => fields[c])],
  );
  if (!rowCount) throw new HttpError(404, 'Item not found');
}

export default function itemsRouter({ db, events }) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const { rows } = await db.query(`${SELECT_ITEMS} ORDER BY i.type, i.name`);
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const fields = parseItemFields(req.body ?? {}, { partial: false });
    const id = await db.tx(async (t) => {
      const newId = await insertItem(t, fields);
      await audit(t, req.user, 'create', 'item', newId, fields);
      return newId;
    });
    events.emit('items', req.user);
    const { rows } = await db.query(`${SELECT_ITEMS} WHERE i.id = $1`, [id]);
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const fields = parseItemFields(req.body ?? {}, { partial: true });
    await db.tx(async (t) => {
      await updateItem(t, id, fields);
      await audit(t, req.user, 'update', 'item', id, fields);
    });
    events.emit('items', req.user);
    const { rows } = await db.query(`${SELECT_ITEMS} WHERE i.id = $1`, [id]);
    res.json(rows[0]);
  });

  // Only possible while an item has no history; otherwise mark it inactive.
  router.delete('/:id', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    await db.tx(async (t) => {
      const { rowCount } = await t.query('DELETE FROM items WHERE id = $1', [id]);
      if (!rowCount) throw new HttpError(404, 'Item not found');
      await audit(t, req.user, 'delete', 'item', id);
    });
    events.emit('items', req.user);
    res.json({ ok: true });
  });

  // Replaces an item's recipe (bill of materials).
  router.put('/:id/components', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const list = req.body?.components;
    if (!Array.isArray(list)) throw badRequest('components must be a list');
    const comps = list.map((c, i) => ({
      component_item_id: uuid(c?.component_item_id, `Component ${i + 1}`),
      qty_per_unit: number(c?.qty_per_unit, `Component ${i + 1} quantity`, { required: true }),
    }));
    comps.forEach((c, i) => {
      if (c.qty_per_unit <= 0) throw badRequest(`Component ${i + 1} quantity must be more than 0`);
      if (c.component_item_id === id) throw badRequest("An item can't be a component of itself");
    });
    await db.tx(async (t) => {
      const { rows } = await t.query('SELECT 1 FROM items WHERE id = $1', [id]);
      if (!rows[0]) throw new HttpError(404, 'Item not found');
      await t.query('DELETE FROM components WHERE parent_item_id = $1', [id]);
      for (const c of comps) {
        await t.query('INSERT INTO components (parent_item_id, component_item_id, qty_per_unit) VALUES ($1, $2, $3)', [
          id,
          c.component_item_id,
          c.qty_per_unit,
        ]);
      }
      await audit(t, req.user, 'set_recipe', 'item', id, { components: comps });
    });
    events.emit('items', req.user);
    const { rows } = await db.query(`${SELECT_ITEMS} WHERE i.id = $1`, [id]);
    res.json(rows[0]);
  });

  return router;
}
