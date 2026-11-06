import { Router } from 'express';
import { audit } from '../audit.js';
import { bool, HttpError, oneOf, text, uuid } from '../http.js';

const KINDS = ['roaster', 'packer', 'other'];

export default function machinesRouter({ db, events }) {
  const router = Router();

  router.get('/', async (_req, res) => {
    const { rows } = await db.query('SELECT id, name, kind, notes, active FROM machines ORDER BY kind, name');
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const b = req.body ?? {};
    const { rows } = await db.query('INSERT INTO machines (name, kind, notes) VALUES ($1, $2, $3) RETURNING *', [
      text(b.name, 'name', { required: true, max: 100 }),
      oneOf(b.kind ?? 'packer', 'kind', KINDS),
      text(b.notes, 'notes'),
    ]);
    await audit(db, req.user, 'create', 'machine', rows[0].id, b);
    events.emit('machines', req.user);
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const b = req.body ?? {};
    const sets = [];
    const vals = [id];
    const add = (col, v) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if ('name' in b) add('name', text(b.name, 'name', { required: true, max: 100 }));
    if ('kind' in b) add('kind', oneOf(b.kind, 'kind', KINDS));
    if ('notes' in b) add('notes', text(b.notes, 'notes'));
    if ('active' in b) add('active', bool(b.active, 'active'));
    if (sets.length === 0) throw new HttpError(400, 'Nothing to update');
    const { rows } = await db.query(`UPDATE machines SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    if (!rows[0]) throw new HttpError(404, 'Machine not found');
    await audit(db, req.user, 'update', 'machine', id, b);
    events.emit('machines', req.user);
    res.json(rows[0]);
  });

  return router;
}
