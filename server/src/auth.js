import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { audit } from './audit.js';
import { HttpError, text } from './http.js';

export const SESSION_COOKIE = 'ledger_session';
const SESSION_SECONDS = 7 * 24 * 3600;

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const hashPassword = (pw, config) => bcrypt.hash(pw, config.bcryptRounds);

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  return pw;
}

// Session = signed JWT in an httpOnly cookie. The user row is re-read on every
// request, so deactivating someone or changing their role applies immediately.
export function requireAuth({ db, config }) {
  return async (req, _res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) throw new HttpError(401, 'Not signed in');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Your session expired. Please sign in again.');
    }
    const { rows } = await db.query('SELECT id, email, name, role FROM users WHERE id = $1 AND active', [payload.sub]);
    if (!rows[0]) throw new HttpError(401, 'Account is disabled');
    req.user = rows[0];
    next();
  };
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Only admins can do that');
  next();
}

// Blocks cross-site form posts: browsers can't add custom headers cross-origin
// without a CORS preflight, which this server never approves.
export function requireAppHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'ledger') throw new HttpError(403, 'Missing request header');
  next();
}

function loginLimiter() {
  const attempts = new Map();
  const WINDOW = 15 * 60 * 1000;
  return (req, _res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.reset < now) attempts.set(key, { count: 1, reset: now + WINDOW });
    else if (++entry.count > 10) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    next();
  };
}

export function authRouter(ctx) {
  const { db, config } = ctx;
  const router = Router();

  router.post('/login', loginLimiter(), async (req, res) => {
    const email = text(req.body?.email, 'email', { required: true })?.toLowerCase();
    const password = String(req.body?.password ?? '');
    const { rows } = await db.query('SELECT id, email, name, role, password_hash, active FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = user && user.active && (await bcrypt.compare(password, user.password_hash));
    if (!ok) throw new HttpError(401, 'Wrong email or password');

    const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: SESSION_SECONDS });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: SESSION_SECONDS * 1000,
      path: '/',
    });
    await audit(db, user, 'login', 'user', user.id);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  const authed = requireAuth(ctx);

  router.get('/me', authed, (req, res) => res.json({ user: req.user }));

  router.post('/password', authed, async (req, res) => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body?.current ?? ''), rows[0].password_hash))) {
      throw new HttpError(400, 'Current password is wrong');
    }
    const hash = await hashPassword(checkPasswordStrength(req.body?.next), config);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    await audit(db, req.user, 'change_password', 'user', req.user.id);
    res.json({ ok: true });
  });

  return router;
}

/** Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when there are no users yet. */
export async function bootstrapAdmin(db, config) {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0 || !config.adminEmail || !config.adminPassword) return false;
  await db.query("INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Admin', $2, 'admin')", [
    config.adminEmail.toLowerCase(),
    await hashPassword(config.adminPassword, config),
  ]);
  console.log(`Created first admin account ${config.adminEmail}`);
  return true;
}
