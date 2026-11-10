import { Router } from 'express';
import { audit } from '../audit.js';
import { requireAdmin } from '../auth.js';
import { HttpError } from '../http.js';
import { hasSampleData, loadSampleData, removeSampleData, SAMPLE_ALLOWED_ENVS } from '../sample-data.js';

// Admin-only sample data for practice copies. Refused outright in production.
export default function sampleRouter({ db, config, events }) {
  const router = Router();
  router.use(requireAdmin);
  const allowed = SAMPLE_ALLOWED_ENVS.has(config.appEnv);
  const guard = () => {
    if (!allowed) throw new HttpError(403, 'Sample data is only available in practice copies (staging or local), never production.');
  };

  router.get('/', async (_req, res) => {
    res.json({ allowed, loaded: allowed ? await hasSampleData(db) : false });
  });

  router.post('/', async (req, res) => {
    guard();
    const counts = await db.tx(async (t) => {
      if (await hasSampleData(t)) throw new HttpError(409, 'Sample data is already loaded. Remove it first to load a fresh set.');
      return loadSampleData(t, req.user);
    });
    await audit(db, req.user, 'load_sample_data', 'sample_data', null, counts);
    events.emit('movements', req.user);
    res.status(201).json(counts);
  });

  router.delete('/', async (req, res) => {
    guard();
    const counts = await db.tx((t) => removeSampleData(t));
    await audit(db, req.user, 'remove_sample_data', 'sample_data', null, counts);
    events.emit('movements', req.user);
    res.json(counts);
  });

  return router;
}
