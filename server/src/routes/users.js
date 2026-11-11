import { Router } from 'express';
import { audit } from '../audit.js';
import { checkPasswordStrength, hashPassword, requireAdmin, resetTwoFactor } from '../auth.js';
import { bool, HttpError, oneOf, text, uuid } from '../http.js';

const ROLES = ['admin', 'member'];
const PUBLIC_COLS =
  'id, email, name, role, role_id, (SELECT name FROM roles WHERE roles.id = users.role_id) AS role_name, active, (totp_enabled_at IS NOT NULL) AS two_factor';

// Turns { role, role_id } from the request into what gets saved, or null when the
// request doesn't touch access. "admin" can do everything; a "member" gets what their role lists.
async function accessFrom(db, b) {
  if (!('role' in b) && !('role_id' in b)) return null;
  if (b.role === 'admin') return { role: 'admin', role_id: null };
  if (b.role !== undefined) oneOf(b.role, 'role', ROLES);
  let roleId = uuid(b.role_id, 'role', { required: false });
  if (!roleId) {
    // No role chosen: start people with the safest one (look but don't touch).
    const { rows } = await db.query("SELECT id FROM roles WHERE name = 'View only'");
    roleId = rows[0]?.id ?? null;
  } else {
    const { rows } = await db.query('SELECT 1 FROM roles WHERE id = $1', [roleId]);
    if (!rows[0]) throw new HttpError(400, 'That role no longer exists');
  }
  return { role: 'member', role_id: roleId };
}

export default function usersRouter({ db, config, events }) {
  const router = Router();
  router.use(requireAdmin);

  // Doing the reset someone asked for closes their open request of that kind.
  const resolveHelp = (userId, kind, adminId) =>
    db.query(
      'UPDATE help_requests SET resolved_at = NOW(), resolved_by = $3 WHERE user_id = $1 AND kind = $2 AND resolved_at IS NULL',
      [userId, kind, adminId],
    );

  // Sign-in help requests: open ones, plus those handled in the last 14 days.
  router.get('/help-requests', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT h.id, h.email, h.kind, h.note, h.created_at, h.resolved_at, h.user_id,
              u.name AS user_name, u.active AS user_active, (u.totp_enabled_at IS NOT NULL) AS user_two_factor,
              r.name AS resolved_by_name
         FROM help_requests h
         LEFT JOIN users u ON u.id = h.user_id
         LEFT JOIN users r ON r.id = h.resolved_by
        WHERE h.resolved_at IS NULL OR h.resolved_at > NOW() - INTERVAL '14 days'
        ORDER BY (h.resolved_at IS NULL) DESC, h.created_at DESC
        LIMIT 100`,
    );
    res.json(rows);
  });

  router.post('/help-requests/:id/resolve', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const { rows } = await db.query(
      'UPDATE help_requests SET resolved_at = NOW(), resolved_by = $2 WHERE id = $1 AND resolved_at IS NULL RETURNING id',
      [id, req.user.id],
    );
    if (!rows[0]) throw new HttpError(404, 'Request not found or already handled');
    await audit(db, req.user, 'resolve', 'help_request', id);
    res.json({ ok: true });
  });

  router.get('/', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLS}, created_at FROM users ORDER BY active DESC, name`,
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const b = req.body ?? {};
    const email = text(b.email, 'email', { required: true, max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email is not valid');
    const hash = await hashPassword(checkPasswordStrength(b.password), config);
    const access = await accessFrom(db, 'role' in b || 'role_id' in b ? b : { role: 'member' });
    const { rows } = await db.query(
      `INSERT INTO users (email, name, password_hash, role, role_id) VALUES ($1, $2, $3, $4, $5) RETURNING ${PUBLIC_COLS}`,
      [email, text(b.name, 'name', { required: true, max: 100 }), hash, access.role, access.role_id],
    );
    await audit(db, req.user, 'create', 'user', rows[0].id, { email, role: rows[0].role_name ?? rows[0].role });
    events.emit('users', req.user);
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const b = req.body ?? {};
    const access = await accessFrom(db, b);
    if (id === req.user.id && (b.active === false || (access && access.role !== 'admin'))) {
      throw new HttpError(400, "You can't remove your own admin access");
    }
    const sets = [];
    const vals = [id];
    const add = (col, v) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if ('name' in b) add('name', text(b.name, 'name', { required: true, max: 100 }));
    if (access) {
      add('role', access.role);
      add('role_id', access.role_id);
    }
    if ('active' in b) add('active', bool(b.active, 'active'));
    if ('password' in b) {
      add('password_hash', await hashPassword(checkPasswordStrength(b.password), config));
      sets.push('session_version = session_version + 1'); // a reset signs them out everywhere
    }
    if (sets.length === 0) throw new HttpError(400, 'Nothing to update');
    const { rows } = await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${PUBLIC_COLS}`,
      vals,
    );
    if (!rows[0]) throw new HttpError(404, 'User not found');
    const { password: _pw, ...logged } = b;
    await audit(db, req.user, 'update', 'user', id, { ...logged, ...(access ? { role_name: rows[0].role_name ?? 'Administrator' } : {}), password_reset: 'password' in b });
    events.emit('users', req.user);
    if ('password' in b) await resolveHelp(id, 'password', req.user.id);
    res.json(rows[0]);
  });

  // Lost phone and backup codes: clear their 2FA. They set it up again at their next sign-in.
  router.post('/:id/reset-2fa', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    if (id === req.user.id) throw new HttpError(400, 'Ask another admin to reset your own two-factor sign-in');
    const { rows } = await db.query('SELECT email FROM users WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'User not found');
    await resetTwoFactor(db, id);
    await audit(db, req.user, 'reset_2fa', 'user', id, { email: rows[0].email });
    await resolveHelp(id, 'two_factor', req.user.id);
    res.json({ ok: true });
  });

  return router;
}

export function auditRouter({ db }) {
  const router = Router();
  router.use(requireAdmin);
  router.get('/', async (_req, res) => {
    const { rows } = await db.query(
      `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.details, u.name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.at DESC LIMIT 500`,
    );
    res.json(rows);
  });
  return router;
}
