import { Router } from 'express';
import { requirePermission } from '../auth.js';
import { text, uuid } from '../http.js';
import { recordCount } from '../inventory.js';

export default function stockRouter({ db, events }) {
  const router = Router();

  // On hand = sum of all non-voided movement lines per item.
  router.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT i.id, i.code, i.name, i.type, i.unit, i.active, i.sage_item_code, i.supplier,
              i.reorder_point::float8, i.pack_size_oz::float8, i.units_per_case,
              ROUND(COALESCE(SUM(l.qty) FILTER (WHERE m.voided_at IS NULL), 0), 4)::float8 AS on_hand,
              MAX(m.occurred_at) FILTER (WHERE m.voided_at IS NULL) AS last_movement_at
         FROM items i
         LEFT JOIN movement_lines l ON l.item_id = i.id
         LEFT JOIN movements m ON m.id = l.movement_id
        WHERE ($1::boolean OR i.active)
        GROUP BY i.id
        ORDER BY i.type, i.name`,
      [req.query.include_inactive === 'true'],
    );
    res.json(rows);
  });

  // Remaining quantity per lot code for one item.
  router.get('/lots', async (req, res) => {
    const { rows } = await db.query(
      `SELECT COALESCE(l.lot_code, '') AS lot_code, ROUND(SUM(l.qty), 4)::float8 AS on_hand,
              MIN(m.occurred_at) AS first_seen
         FROM movement_lines l JOIN movements m ON m.id = l.movement_id
        WHERE m.voided_at IS NULL AND l.item_id = $1
        GROUP BY l.lot_code
       HAVING ROUND(SUM(l.qty), 4) <> 0
        ORDER BY first_seen`,
      [uuid(req.query.item_id, 'item')],
    );
    res.json(rows);
  });

  router.post('/count', requirePermission('adjust'), async (req, res) => {
    const b = req.body ?? {};
    const result = await db.tx((t) =>
      recordCount(t, req.user, { counts: b.counts, notes: text(b.notes, 'notes', { max: 2000 }) }),
    );
    if (result.id) events.emit('movements', req.user);
    res.json(result);
  });

  return router;
}
