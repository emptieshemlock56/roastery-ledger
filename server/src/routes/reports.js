import { Router } from 'express';
import { HttpError } from '../http.js';

function requiredDate(value, field) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) throw new HttpError(400, `${field} date is required`);
  return d;
}

export default function reportsRouter({ db }) {
  const router = Router();

  // Production totals per kind / machine / output item for a date range.
  // input_lbs = coffee (lb-unit items) consumed, so roast yield = output / input.
  router.get('/production', async (req, res) => {
    const from = requiredDate(req.query.from, 'from');
    const to = requiredDate(req.query.to, 'to');
    const { rows } = await db.query(
      `WITH mv AS (
         SELECT id, kind, machine_id FROM movements
          WHERE voided_at IS NULL AND kind IN ('roast', 'blend', 'pack')
            AND occurred_at >= $1 AND occurred_at < $2
       ), inputs AS (
         SELECT l.movement_id, SUM(-l.qty) FILTER (WHERE i.unit = 'lb') AS input_lbs
           FROM movement_lines l JOIN items i ON i.id = l.item_id
          WHERE l.qty < 0 AND l.movement_id IN (SELECT id FROM mv)
          GROUP BY l.movement_id
       )
       SELECT mv.kind, COALESCE(mc.name, '') AS machine, i.code, i.name, i.unit, i.units_per_case,
              COUNT(DISTINCT mv.id)::int AS runs,
              ROUND(SUM(l.qty), 4)::float8 AS output_qty,
              ROUND(SUM(inputs.input_lbs), 4)::float8 AS input_lbs
         FROM mv
         JOIN movement_lines l ON l.movement_id = mv.id AND l.qty > 0
         JOIN items i ON i.id = l.item_id
         LEFT JOIN machines mc ON mc.id = mv.machine_id
         LEFT JOIN inputs ON inputs.movement_id = mv.id
        GROUP BY mv.kind, mc.name, i.code, i.name, i.unit, i.units_per_case
        ORDER BY mv.kind, machine, i.name`,
      [from, to],
    );
    res.json(rows);
  });

  return router;
}
