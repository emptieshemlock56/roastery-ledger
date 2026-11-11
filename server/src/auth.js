import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { audit } from './audit.js';
import { HttpError, text } from './http.js';
import { PERMISSION_KEYS, permissionLabel } from './permissions.js';
import { hashBackupCode, matchStep, newBackupCodes, newSecret, normalizeCode, otpauthUrl } from './totp.js';

export const SESSION_COOKIE = 'ledger_session';
const SESSION_SECONDS = 7 * 24 * 3600;
const CODE_TICKET_SECONDS = 5 * 60; // time allowed between the password step and the code step

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

const USER_COLS = 'id, email, name, role, role_id, active, session_version, totp_enabled_at';

/** What a person may change: admins everything, members whatever their role lists (no role = view only). */
export async function permissionsFor(db, u) {
  if (u.role === 'admin') return [...PERMISSION_KEYS];
  if (!u.role_id) return [];
  const { rows } = await db.query('SELECT permissions FROM roles WHERE id = $1', [u.role_id]);
  return rows[0]?.permissions ?? [];
}

/** What the browser is told about the signed-in user. */
export async function publicUser(db, u, config) {
  const twoFactor = Boolean(u.totp_enabled_at);
  const roleName = u.role === 'admin' ? 'Administrator' : (await db.query('SELECT name FROM roles WHERE id = $1', [u.role_id])).rows[0]?.name ?? 'No role';
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    role_name: roleName,
    permissions: await permissionsFor(db, u),
    two_factor: twoFactor,
    two_factor_required: config.require2fa,
    must_setup_2fa: config.require2fa && !twoFactor,
  };
}

// Session = signed JWT in an httpOnly cookie. It carries the user's session_version,
// so bumping that column signs them out everywhere.
function issueSession(res, user, config) {
  const token = jwt.sign({ sub: user.id, sv: user.session_version, typ: 'session' }, config.jwtSecret, { expiresIn: SESSION_SECONDS });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: SESSION_SECONDS * 1000,
    path: '/',
  });
}

async function bumpSessionVersion(db, userId) {
  const { rows } = await db.query(
    `UPDATE users SET session_version = session_version + 1 WHERE id = $1 RETURNING ${USER_COLS}`,
    [userId],
  );
  return rows[0];
}

// The user row is re-read on every request, so deactivating someone, changing
// their role or signing them out everywhere applies immediately.
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
    if (payload.typ !== 'session') throw new HttpError(401, 'Please sign in again.');
    const { rows } = await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1 AND active`, [payload.sub]);
    const u = rows[0];
    if (!u) throw new HttpError(401, 'Account is disabled');
    if (u.session_version !== payload.sv) throw new HttpError(401, 'You were signed out. Please sign in again.');
    req.user = {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      two_factor: Boolean(u.totp_enabled_at),
      permissions: await permissionsFor(db, u),
    };
    next();
  };
}

/** Where 2FA is required, everything except the sign-in/setup endpoints waits until it's set up. */
export function requireTwoFactorReady(config) {
  return (req, _res, next) => {
    if (config.require2fa && !req.user.two_factor) throw new HttpError(403, 'Set up two-factor sign-in first');
    next();
  };
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Only admins can do that');
  next();
}

export const can = (user, permission) => Boolean(user?.permissions?.includes(permission));

/** Throws unless the signed-in person's role allows `permission`. */
export function assertCan(user, permission) {
  if (!can(user, permission)) {
    throw new HttpError(403, `Your role isn't allowed to do that (${permissionLabel(permission)}). Ask an admin if you need it.`);
  }
}

export const requirePermission = (permission) => (req, _res, next) => {
  assertCan(req.user, permission);
  next();
};

/** Looking is open to everyone signed in; only changes (POST/PUT/PATCH/DELETE) need the permission. */
export const requireWritePermission = (permission) => (req, res, next) =>
  ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : requirePermission(permission)(req, res, next);

// Blocks cross-site form posts: browsers can't add custom headers cross-origin
// without a CORS preflight, which this server never approves.
export function requireAppHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'ledger') throw new HttpError(403, 'Missing request header');
  next();
}

/** Counts failed attempts per key (IP address or account) and blocks after too many. */
function failureLimiter({ max, windowMs = 15 * 60 * 1000 }) {
  const failures = new Map();
  const current = (key) => {
    const e = failures.get(key);
    return e && e.reset > Date.now() ? e : null;
  };
  return {
    check(...keys) {
      if (keys.some((k) => (current(k)?.count ?? 0) >= max)) {
        throw new HttpError(429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
      }
    },
    fail(...keys) {
      for (const k of keys) {
        const e = current(k);
        if (e) e.count++;
        else failures.set(k, { count: 1, reset: Date.now() + windowMs });
      }
    },
  };
}

/** Accepts a 6-digit authenticator code once (a code can't be replayed). */
async function useAuthenticatorCode(db, userId, secret, code) {
  const step = matchStep(secret, code);
  if (step === null) return false;
  const { rows } = await db.query(
    'UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2) RETURNING id',
    [userId, step],
  );
  return rows.length > 0;
}

async function useBackupCode(db, userId, code) {
  const { rows } = await db.query(
    'UPDATE backup_codes SET used_at = NOW() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id',
    [userId, hashBackupCode(code)],
  );
  return rows.length > 0;
}

async function replaceBackupCodes(q, userId) {
  const codes = newBackupCodes();
  await q.query('DELETE FROM backup_codes WHERE user_id = $1', [userId]);
  for (const c of codes) await q.query('INSERT INTO backup_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hashBackupCode(c)]);
  return codes;
}

/** Clears a user's 2FA and signs them out everywhere (lost phone). */
export async function resetTwoFactor(db, userId) {
  await db.tx(async (t) => {
    await t.query(
      `UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL,
              session_version = session_version + 1
        WHERE id = $1`,
      [userId],
    );
    await t.query('DELETE FROM backup_codes WHERE user_id = $1', [userId]);
  });
}

export function authRouter(ctx) {
  const { db, config } = ctx;
  const router = Router();
  const limiter = failureLimiter({ max: 20 });

  // Step 1: email + password. Signs in directly, or asks for a code if 2FA is on.
  router.post('/login', async (req, res) => {
    limiter.check(`ip:${req.ip}`);
    const email = text(req.body?.email, 'email', { required: true })?.toLowerCase();
    const password = String(req.body?.password ?? '');
    const { rows } = await db.query(`SELECT ${USER_COLS}, password_hash FROM users WHERE email = $1`, [email]);
    const user = rows[0];
    const ok = user && user.active && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      limiter.fail(`ip:${req.ip}`);
      throw new HttpError(401, 'Wrong email or password');
    }

    if (user.totp_enabled_at) {
      const ticket = jwt.sign({ sub: user.id, sv: user.session_version, typ: 'code' }, config.jwtSecret, { expiresIn: CODE_TICKET_SECONDS });
      return res.json({ needs_code: true, ticket });
    }
    issueSession(res, user, config);
    await audit(db, user, 'login', 'user', user.id);
    res.json({ user: await publicUser(db, user, config) });
  });

  // Step 2: the 6-digit authenticator code, or a backup code.
  router.post('/login/code', async (req, res) => {
    let payload;
    try {
      payload = jwt.verify(String(req.body?.ticket ?? ''), config.jwtSecret);
    } catch {
      throw new HttpError(401, 'That took too long. Please sign in again.');
    }
    if (payload.typ !== 'code') throw new HttpError(401, 'Please sign in again.');
    limiter.check(`ip:${req.ip}`, `user:${payload.sub}`);

    const { rows } = await db.query(`SELECT ${USER_COLS}, totp_secret FROM users WHERE id = $1 AND active`, [payload.sub]);
    const user = rows[0];
    if (!user || user.session_version !== payload.sv || !user.totp_enabled_at) throw new HttpError(401, 'Please sign in again.');

    const code = normalizeCode(req.body?.code);
    let method = null;
    if (/^\d{6}$/.test(code)) {
      if (await useAuthenticatorCode(db, user.id, user.totp_secret, code)) method = 'authenticator';
    } else if (code.length === 10 && (await useBackupCode(db, user.id, code))) {
      method = 'backup_code';
    }
    if (!method) {
      limiter.fail(`ip:${req.ip}`, `user:${user.id}`);
      throw new HttpError(401, "That code didn't work. Check the code in your authenticator app and try again.");
    }

    issueSession(res, user, config);
    const details = { method };
    if (method === 'backup_code') {
      const left = await db.query('SELECT COUNT(*)::int AS n FROM backup_codes WHERE user_id = $1 AND used_at IS NULL', [user.id]);
      details.backup_codes_left = left.rows[0].n;
    }
    await audit(db, user, 'login', 'user', user.id, details);
    res.json({ user: await publicUser(db, user, config), backup_codes_left: details.backup_codes_left });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  const authed = requireAuth(ctx);
  const loadUser = async (id) => (await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id])).rows[0];

  router.get('/me', authed, async (req, res) => res.json({ user: await publicUser(db, await loadUser(req.user.id), config) }));

  // Changing your password signs you out everywhere else; this browser stays signed in.
  router.post('/password', authed, async (req, res) => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body?.current ?? ''), rows[0].password_hash))) {
      throw new HttpError(400, 'Current password is wrong');
    }
    const hash = await hashPassword(checkPasswordStrength(req.body?.next), config);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    issueSession(res, await bumpSessionVersion(db, req.user.id), config);
    await audit(db, req.user, 'change_password', 'user', req.user.id);
    res.json({ ok: true });
  });

  router.post('/logout-others', authed, async (req, res) => {
    issueSession(res, await bumpSessionVersion(db, req.user.id), config);
    await audit(db, req.user, 'sign_out_everywhere', 'user', req.user.id);
    res.json({ ok: true });
  });

  // 2FA setup: get a QR code, then confirm with the first code from the app.
  router.post('/2fa/setup', authed, async (req, res) => {
    if (req.user.two_factor) throw new HttpError(400, 'Two-factor sign-in is already on');
    const secret = newSecret();
    await db.query('UPDATE users SET totp_pending_secret = $2 WHERE id = $1', [req.user.id, secret]);
    const url = otpauthUrl({ secret, account: req.user.email, issuer: config.totpIssuer });
    const qr_svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.json({ secret, otpauth_url: url, qr_svg });
  });

  router.post('/2fa/enable', authed, async (req, res) => {
    const { rows } = await db.query('SELECT totp_pending_secret, totp_enabled_at FROM users WHERE id = $1', [req.user.id]);
    const { totp_pending_secret: secret, totp_enabled_at: enabled } = rows[0];
    if (enabled) throw new HttpError(400, 'Two-factor sign-in is already on');
    if (!secret) throw new HttpError(400, 'Start the setup again');
    const step = matchStep(secret, normalizeCode(req.body?.code));
    if (step === null) throw new HttpError(400, "That code didn't match. Make sure you scanned the code on this screen, then try the newest code.");

    const codes = await db.tx(async (t) => {
      await t.query(
        `UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = NOW(), totp_last_step = $2
          WHERE id = $1`,
        [req.user.id, step],
      );
      return replaceBackupCodes(t, req.user.id);
    });
    await audit(db, req.user, 'enable_2fa', 'user', req.user.id);
    res.json({ backup_codes: codes, user: await publicUser(db, await loadUser(req.user.id), config) });
  });

  // New backup codes (the old ones stop working). Needs a current authenticator code.
  router.post('/2fa/backup-codes', authed, async (req, res) => {
    const { rows } = await db.query('SELECT totp_secret FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0].totp_secret) throw new HttpError(400, 'Two-factor sign-in is not on');
    if (!(await useAuthenticatorCode(db, req.user.id, rows[0].totp_secret, normalizeCode(req.body?.code)))) {
      throw new HttpError(400, "That code didn't work. Use the newest code from your authenticator app.");
    }
    const codes = await db.tx((t) => replaceBackupCodes(t, req.user.id));
    await audit(db, req.user, 'new_backup_codes', 'user', req.user.id);
    res.json({ backup_codes: codes });
  });

  // Only possible where 2FA isn't required (local dev).
  router.post('/2fa/disable', authed, async (req, res) => {
    if (config.require2fa) throw new HttpError(400, 'Two-factor sign-in is required here. An admin can reset it if you lose your phone.');
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!(await bcrypt.compare(String(req.body?.password ?? ''), rows[0].password_hash))) throw new HttpError(400, 'Password is wrong');
    await resetTwoFactor(db, req.user.id);
    issueSession(res, await loadUser(req.user.id), config);
    await audit(db, req.user, 'disable_2fa', 'user', req.user.id);
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
