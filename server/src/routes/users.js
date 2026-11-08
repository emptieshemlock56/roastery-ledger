import { Router } from 'express';
import { audit } from '../audit.js';
import { checkPasswordStrength, hashPassword, requireAdmin, resetTwoFactor } from '../auth.js';
import { bool, HttpError, oneOf, text, uuid } from '../http.js';

const ROLES = ['admin', 'member'];
const PUBLIC_COLS = 'id, email, name, role, active, (totp_enabled_at IS NOT NULL) AS two_factor';

export default function usersRouter({ db, config }) {
  const router = Router();
  router.use(requireAdmin);

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
    const { rows } = await db.query(
      `INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_COLS}`,
      [email, text(b.name, 'name', { required: true, max: 100 }), hash, oneOf(b.role ?? 'member', 'role', ROLES)],
    );
    await audit(db, req.user, 'create', 'user', rows[0].id, { email, role: rows[0].role });
    res.status(201).json(rows[0]);
  });

  router.patch('/:id', async (req, res) => {
    const id = uuid(req.params.id, 'id');
    const b = req.body ?? {};
    if (id === req.user.id && (b.active === false || (b.role && b.role !== 'admin'))) {
      throw new HttpError(400, "You can't remove your own admin access");
    }
    const sets = [];
    const vals = [id];
    const add = (col, v) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if ('name' in b) add('name', text(b.name, 'name', { required: true, max: 100 }));
    if ('role' in b) add('role', oneOf(b.role, 'role', ROLES));
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
    await audit(db, req.user, 'update', 'user', id, { ...logged, password_reset: 'password' in b });
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
