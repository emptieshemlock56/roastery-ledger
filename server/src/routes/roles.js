import { Router } from 'express';
import { audit } from '../audit.js';
import { requireAdmin } from '../auth.js';
import { HttpError, text, uuid } from '../http.js';
import { cleanPermissions, PERMISSIONS } from '../permissions.js';

const SELECT_ROLES = `
  SELECT r.id, r.name, r.description, r.permissions,
         (SELECT COUNT(*)::int FROM users u WHERE u.role_id = r.id) AS user_count
    FROM roles r`;

function permissionsFrom(value) {
  try {
    return cleanPermissions(value);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
}

// Admins decide what each role may change. Administrators always can do everything.
export default function rolesRouter({ db, events }) {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', async (_req, res) => {
    const { rows } = await db.query(`${SELECT_ROLES} ORDER BY r.name`);
    res.json({ permissions: PERMISSIONS, roles: rows });
  });

  router.post('/', async (req, res) => {
    const b = req.body ?? {};
    const name = text(b.name, 'name', { required: true, max: 60 });
    const permissions = permissionsFrom(b.permissions ?? []);
    const dup = await db.query('SELECT 1 FROM roles WHERE lower(name) = lower($1)', [name]);
    if (dup.rows[0]) throw new HttpError(409, `There is already a role called "${name}"`);
    const { rows } = await db.query(
      'INSERT INTO roles (name, description, permissions) VALUES ($1, $2, $3::jsonb) RETURNING id',
      [name, text(b.description, 'description', { max: 300 }), JSON.stringify(permissions)],
    );
    await audit(db, req.user, 'create', 'role', rows[0].id, { name, permissions });
    events.emit('roles', req.user);
    res.status(201).json((await db.query(`${SELECT_ROLES} WHERE r.id = $1`, [rows[0].id])).rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const b = req.body ?? {};
    const sets = [];
    const vals = [id];
    const add = (col, v, cast = '') => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}${cast}`);
    };
    const changes = {};
    if ('name' in b) {
      const name = text(b.name, 'name', { required: true, max: 60 });
      const dup = await db.query('SELECT 1 FROM roles WHERE lower(name) = lower($1) AND id <> $2', [name, id]);
      if (dup.rows[0]) throw new HttpError(409, `There is already a role called "${name}"`);
      add('name', name);
      changes.name = name;
    }
    if ('description' in b) {
      add('description', text(b.description, 'description', { max: 300 }));
      changes.description = b.description;
    }
    if ('permissions' in b) {
      const permissions = permissionsFrom(b.permissions);
      add('permissions', JSON.stringify(permissions), '::jsonb');
      changes.permissions = permissions;
    }
    if (sets.length === 0) throw new HttpError(400, 'Nothing to update');
    const { rowCount } = await db.query(`UPDATE roles SET ${sets.join(', ')} WHERE id = $1`, vals);
    if (!rowCount) throw new HttpError(404, 'Role not found');
    await audit(db, req.user, 'update', 'role', id, changes);
    events.emit('roles', req.user);
    res.json((await db.query(`${SELECT_ROLES} WHERE r.id = $1`, [id])).rows[0]);
  });

  // A role that still has people in it can't be deleted: move them to another role first.
  router.delete('/:id', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const { rows } = await db.query(`${SELECT_ROLES} WHERE r.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Role not found');
    if (rows[0].user_count > 0) {
      throw new HttpError(409, `${rows[0].user_count} ${rows[0].user_count === 1 ? 'person is' : 'people are'} still in "${rows[0].name}". Move them to another role first.`);
    }
    await db.query('DELETE FROM roles WHERE id = $1', [id]);
    await audit(db, req.user, 'delete', 'role', id, { name: rows[0].name });
    events.emit('roles', req.user);
    res.json({ ok: true });
  });

  return router;
}
