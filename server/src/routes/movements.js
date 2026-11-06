import { Router } from 'express';
import { audit } from '../audit.js';
import { HttpError, number, oneOf, text, uuid } from '../http.js';
import { createMovement, previewMovement } from '../inventory.js';
import { KINDS } from '../rules.js';

const SELECT_MOVEMENTS = `
  SELECT m.id, m.kind, m.occurred_at, m.reference, m.notes, m.created_at,
         m.voided_at, m.void_reason, m.machine_id, mc.name AS machine_name,
         u.name AS created_by_name, vu.name AS voided_by_name,
         COALESCE((SELECT json_agg(json_build_object(
                     'item_id', l.item_id, 'code', i.code, 'name', i.name, 'type', i.type,
                     'unit', i.unit, 'lot_code', l.lot_code, 'qty', l.qty::float8) ORDER BY l.qty DESC, i.name)
                   FROM movement_lines l JOIN items i ON i.id = l.item_id
                  WHERE l.movement_id = m.id), '[]') AS lines
    FROM movements m
    LEFT JOIN machines mc ON mc.id = m.machine_id
    LEFT JOIN users u ON u.id = m.created_by
    LEFT JOIN users vu ON vu.id = m.voided_by`;

function optionalDate(value, field) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${field} is not a valid date`);
  return d;
}

export default function movementsRouter({ db, events }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const q = req.query;
    const limit = Math.min(number(q.limit, 'limit', { min: 1, integer: true }) ?? 300, 2000);
    const { rows } = await db.query(
      `${SELECT_MOVEMENTS}
       WHERE ($1::timestamptz IS NULL OR m.occurred_at >= $1)
         AND ($2::timestamptz IS NULL OR m.occurred_at < $2)
         AND ($3::text IS NULL OR m.kind = $3)
         AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM movement_lines x WHERE x.movement_id = m.id AND x.item_id = $4))
         AND ($5::boolean OR m.voided_at IS NULL)
       ORDER BY m.occurred_at DESC, m.created_at DESC
       LIMIT $6`,
      [
        optionalDate(q.from, 'from'),
        optionalDate(q.to, 'to'),
        oneOf(q.kind, 'kind', KINDS, { required: false }),
        uuid(q.item_id, 'item', { required: false }),
        q.include_voided !== 'false',
        limit,
      ],
    );
    res.json(rows);
  });

  router.post('/preview', async (req, res) => {
    res.json(await previewMovement(db, req.body ?? {}));
  });

  router.post('/', async (req, res) => {
    const result = await db.tx((t) => createMovement(t, req.user, req.body ?? {}));
    events.emit('movements', req.user);
    const { rows } = await db.query(`${SELECT_MOVEMENTS} WHERE m.id = $1`, [result.id]);
    res.status(201).json({ movement: rows[0], warnings: result.warnings });
  });

  // Mistakes are voided, not deleted, so the history stays complete.
  router.post('/:id/void', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const reason = text(req.body?.reason, 'reason', { required: true, max: 500 });
    await db.tx(async (t) => {
      const { rows } = await t.query('SELECT voided_at FROM movements WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw new HttpError(404, 'Entry not found');
      if (rows[0].voided_at) throw new HttpError(409, 'Already voided');
      await t.query('UPDATE movements SET voided_at = NOW(), voided_by = $2, void_reason = $3 WHERE id = $1', [
        id,
        req.user.id,
        reason,
      ]);
      await audit(t, req.user, 'void', 'movement', id, { reason });
    });
    events.emit('movements', req.user);
    const { rows } = await db.query(`${SELECT_MOVEMENTS} WHERE m.id = $1`, [id]);
    res.json(rows[0]);
  });

  return router;
}
