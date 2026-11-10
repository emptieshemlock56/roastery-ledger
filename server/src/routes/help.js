import { Router } from 'express';
import { audit } from '../audit.js';
import { HttpError, oneOf, text } from '../http.js';

export const HELP_KINDS = { password: 'Password reset', two_factor: 'Two-factor reset' };
const SENT = { ok: true, message: 'Your request was sent to an admin. They will contact you to confirm it is really you.' };

/** Counts every request (not just failures) per key, and blocks after `max` in the window. */
function requestLimiter({ max, windowMs }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const e = hits.get(key);
    if (!e || e.reset < now) hits.set(key, { count: 1, reset: now + windowMs });
    else if (++e.count > max) return false;
    return true;
  };
}

// POST /api/auth/help: "Need help signing in?" from the sign-in page (no sign-in needed).
// The answer is the same whether or not the email has an account, so the form can't be
// used to find out who has one.
export function helpRequestRouter({ db, config, mailer }) {
  const router = Router();
  const perIp = requestLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
  const perEmail = requestLimiter({ max: 3, windowMs: 60 * 60 * 1000 });

  router.post('/', async (req, res) => {
    const b = req.body ?? {};
    const email = text(b.email, 'Email', { required: true, max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address');
    const kind = oneOf(b.kind, 'What you need', Object.keys(HELP_KINDS));
    const note = text(b.note, 'Note', { max: 500 });
    if (!perIp(req.ip)) throw new HttpError(429, 'Too many requests. Please try again in an hour, or contact an admin directly.');
    if (!perEmail(email)) return res.json(SENT); // quietly drop repeats for the same address

    const { rows } = await db.query('SELECT id, name, active, totp_enabled_at FROM users WHERE email = $1', [email]);
    const user = rows[0] ?? null;
    const ins = await db.query(
      'INSERT INTO help_requests (email, kind, note, user_id, ip) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [email, kind, note, user?.id ?? null, req.ip],
    );
    await audit(db, null, 'help_request', 'help_request', ins.rows[0].id, { email, kind, account_found: Boolean(user) });

    if (mailer.enabled && config.helpRequestEmail) {
      const status = !user
        ? 'NO ACCOUNT has this email. It may be a typo, or someone who should not have access.'
        : `Account: ${user.name}${user.active ? '' : ' (DEACTIVATED)'}, two-factor ${user.totp_enabled_at ? 'on' : 'not set up'}`;
      const where = config.appEnv === 'production' ? '' : ` [${config.appEnv.toUpperCase()}]`;
      const lines = [
        `Someone asked for help signing in to Roastery Ledger${where}.`,
        '',
        `Email:   ${email}`,
        `Needs:   ${HELP_KINDS[kind]}`,
        status,
        note ? `\nTheir note:\n${note}` : null,
        '',
        'Before resetting anything, confirm it is really them (in person or by phone,',
        'not by replying to an email). Anyone can fill in this form with any address.',
        '',
        `Handle it on the Users page${config.publicUrl ? `: ${config.publicUrl}/#/users` : '.'}`,
      ].filter((l) => l !== null);
      // Send in the background: the person gets the same answer either way, and the
      // request is already saved on the Users page if the email fails.
      mailer
        .send({ to: config.helpRequestEmail, subject: `Sign-in help${where}: ${HELP_KINDS[kind]} for ${email}`, text: lines.join('\n') })
        .catch((err) => console.error(`Help request email failed: ${err.message}`));
    }
    res.json(SENT);
  });

  return router;
}
