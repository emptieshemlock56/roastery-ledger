import { Router } from 'express';
import { audit } from '../audit.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../http.js';

const MAX_LOGO_BYTES = 1024 * 1024; // 1 MB is plenty for a logo

// SVG is left out on purpose: it can carry scripts. Real image types are checked by their first bytes.
function sniffImage(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** When the logo last changed (a number), or null if there isn't one. Used by /api/config so pages know to show it. */
export async function logoVersion(db) {
  const { rows } = await db.query('SELECT updated_at FROM branding WHERE logo IS NOT NULL');
  return rows[0] ? new Date(rows[0].updated_at).getTime() : null;
}

// Anyone can fetch the picture (the sign-in page shows it); only admins change it.
export function logoImageRouter({ db }) {
  const router = Router();
  router.get('/logo', async (_req, res) => {
    const { rows } = await db.query('SELECT logo, logo_mime FROM branding WHERE logo IS NOT NULL');
    if (!rows[0]) throw new HttpError(404, 'No logo');
    res
      .type(rows[0].logo_mime)
      .set('Cache-Control', 'no-cache')
      .set('Content-Security-Policy', "default-src 'none'; sandbox")
      .send(Buffer.from(rows[0].logo));
  });
  return router;
}

export default function brandingRouter({ db, events }) {
  const router = Router();
  router.use(requireAdmin);

  // Body: { data: "<base64 of the image file>" }
  router.post('/logo', async (req, res) => {
    const raw = String(req.body?.data ?? '').replace(/^data:[^,]*,/, '');
    if (!raw) throw new HttpError(400, 'Choose an image file first');
    const buf = Buffer.from(raw, 'base64');
    if (buf.length > MAX_LOGO_BYTES) throw new HttpError(400, 'That image is too big. Please use one under 1 MB.');
    const mime = sniffImage(buf);
    if (!mime) throw new HttpError(400, 'Use a PNG, JPG or WebP image.');
    await db.query(
      `INSERT INTO branding (id, logo, logo_mime, updated_at) VALUES (TRUE, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET logo = EXCLUDED.logo, logo_mime = EXCLUDED.logo_mime, updated_at = NOW()`,
      [buf, mime],
    );
    await audit(db, req.user, 'set_logo', 'branding', null, { mime, bytes: buf.length });
    events.emit('branding', req.user);
    res.json({ logo: await logoVersion(db) });
  });

  router.delete('/logo', async (req, res) => {
    await db.query('DELETE FROM branding');
    await audit(db, req.user, 'remove_logo', 'branding', null);
    events.emit('branding', req.user);
    res.json({ logo: null });
  });

  return router;
}
