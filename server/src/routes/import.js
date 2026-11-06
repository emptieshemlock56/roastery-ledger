import { Router } from 'express';
import { audit } from '../audit.js';
import { badRequest, number } from '../http.js';
import { recordCount } from '../inventory.js';
import { insertItem, parseItemFields, updateItem } from './items.js';

// Bulk create/update items from spreadsheet rows (matched by code). If a row has
// an on_hand value, stock is set to that number with one "Import count" adjustment.
// This is how the existing shared spreadsheet gets moved in.
export default function importRouter({ db, events }) {
  const router = Router();

  router.post('/items', async (req, res) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest('No rows to import');
    if (rows.length > 5000) throw badRequest('Too many rows (max 5000)');

    const summary = { created: 0, updated: 0, counted: 0, errors: [] };
    const counts = [];

    await db.tx(async (t) => {
      const { rows: existing } = await t.query('SELECT id, code FROM items');
      const byCode = new Map(existing.map((r) => [r.code.toLowerCase(), r.id]));

      for (const [i, raw] of rows.entries()) {
        const rowNo = i + 2; // +1 for header, +1 for 1-based
        try {
          const row = Object.fromEntries(
            Object.entries(raw ?? {}).map(([k, v]) => [k.trim().toLowerCase(), v === '' ? null : v]),
          );
          if ('active' in row && row.active !== null) row.active = !/^(false|no|0|n)$/i.test(String(row.active));
          const code = String(row.code ?? '').trim();
          const existingId = code ? byCode.get(code.toLowerCase()) : null;
          const known = Object.fromEntries(Object.entries(row).filter(([k]) => FIELD_NAMES.has(k)));

          let id;
          if (existingId) {
            const fields = parseItemFields(known, { partial: true });
            delete fields.code;
            await updateItem(t, existingId, fields);
            id = existingId;
            summary.updated++;
          } else {
            id = await insertItem(t, parseItemFields(known, { partial: false }));
            byCode.set(code.toLowerCase(), id);
            summary.created++;
          }
          const onHand = number(row.on_hand, 'on_hand');
          if (onHand !== null) counts.push({ item_id: id, counted: onHand });
        } catch (err) {
          if (!err.status) throw err;
          summary.errors.push({ row: rowNo, error: err.message });
        }
      }
      if (counts.length) {
        const result = await recordCount(t, req.user, { counts, reference: 'Import count' });
        summary.counted = result.changed;
      }
      await audit(t, req.user, 'import', 'items', null, { ...summary, errors: summary.errors.length });
    });

    events.emit('items', req.user);
    events.emit('movements', req.user);
    res.json(summary);
  });

  return router;
}

const FIELD_NAMES = new Set([
  'code',
  'name',
  'type',
  'unit',
  'pack_size_oz',
  'units_per_case',
  'supplier',
  'sage_item_code',
  'reorder_point',
  'notes',
  'active',
]);
